"""Transactional email (me-money §6.7): guardian consent, trial reminder, exports.

``Mailer`` is the interface; ``ResendMailer`` (HTTPS API) and ``SmtpMailer`` are the real ones,
chosen by ``MAIL_PROVIDER``; ``FakeMailer`` keeps messages in memory for local and test. Logs
never carry the address or the body: only the template id and a hash of the recipient.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Protocol

import httpx
import structlog

from smriti_api.core.logging import hash_user_id

log = structlog.get_logger(__name__)


class MailError(Exception):
    pass


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str | None = None
    template_id: str = "generic"
    # Idempotency for providers that support it (Resend): one consent mail per request id.
    idempotency_key: str | None = None


class Mailer(Protocol):
    name: str

    async def send(self, message: Email) -> str:
        """Sends one message; returns the provider's message id."""
        ...


@dataclass
class FakeMailer:
    name: str = "fake"
    outbox: list[Email] = field(default_factory=list)

    async def send(self, message: Email) -> str:
        self.outbox.append(message)
        return f"fake-{len(self.outbox)}"


class ResendMailer:
    name = "resend"

    def __init__(
        self, http: httpx.AsyncClient, *, api_key: str, sender: str, base_url: str
    ) -> None:
        self._http = http
        self._key = api_key
        self._from = sender
        self._base = base_url.rstrip("/")

    async def send(self, message: Email) -> str:
        headers = {"Authorization": f"Bearer {self._key}"}
        if message.idempotency_key:
            headers["Idempotency-Key"] = message.idempotency_key
        body: dict[str, object] = {
            "from": self._from,
            "to": [message.to],
            "subject": message.subject,
            "text": message.text,
            "tags": [{"name": "template", "value": message.template_id}],
        }
        if message.html:
            body["html"] = message.html
        try:
            r = await self._http.post(
                f"{self._base}/emails", json=body, headers=headers, timeout=20
            )
        except httpx.HTTPError as exc:
            raise MailError(f"resend unreachable: {type(exc).__name__}") from exc
        if r.status_code >= 400:
            log.warning(
                "mail_failed", provider="resend", status=r.status_code, template=message.template_id
            )
            raise MailError(f"resend status {r.status_code}")
        message_id = str(r.json().get("id", ""))
        log.info(
            "mail_sent",
            provider="resend",
            template=message.template_id,
            to=hash_user_id(message.to),
        )
        return message_id


class SmtpMailer:
    name = "smtp"

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        sender: str,
        starttls: bool = True,
    ) -> None:
        self._host, self._port = host, port
        self._username, self._password = username, password
        self._from = sender
        self._starttls = starttls

    def _send_sync(self, message: Email) -> str:
        msg = EmailMessage()
        msg["From"] = self._from
        msg["To"] = message.to
        msg["Subject"] = message.subject
        msg.set_content(message.text)
        if message.html:
            msg.add_alternative(message.html, subtype="html")
        with smtplib.SMTP(self._host, self._port, timeout=20) as smtp:
            if self._starttls:
                smtp.starttls(context=ssl.create_default_context())
            if self._username:
                smtp.login(self._username, self._password)
            smtp.send_message(msg)
        return str(msg.get("Message-ID", ""))

    async def send(self, message: Email) -> str:
        try:
            message_id = await asyncio.to_thread(self._send_sync, message)
        except (OSError, smtplib.SMTPException) as exc:
            raise MailError(f"smtp failed: {type(exc).__name__}") from exc
        log.info(
            "mail_sent", provider="smtp", template=message.template_id, to=hash_user_id(message.to)
        )
        return message_id


class DisabledMailer:
    """Production without a configured provider: refuses loudly instead of dropping mail."""

    name = "disabled"

    async def send(self, message: Email) -> str:
        raise MailError("no email provider configured (MAIL_PROVIDER)")
