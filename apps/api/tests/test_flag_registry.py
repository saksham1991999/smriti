"""The API reads flag defaults from packages/config (one registry for the server and the apps)."""

from __future__ import annotations

from smriti_api.services import flag_registry
from smriti_api.services.usage import Flags


def test_defaults_come_from_the_shared_registry() -> None:
    f = Flags({})
    assert f.int_or_none("free.practice_questions_per_day") == 30
    assert f.int_or_none("free.sectional_mocks_per_week") == 1
    assert f.int_or_none("free.tutor_messages_per_day") == 5
    assert f.int_or_none("ai.tutor_retention_days") == 180
    assert f.int_or_none("ai.tutor_session_reuse_min") == 30
    assert f.int_or_none("league.group_size") == 30
    assert f.get("league.close_time") == "23:59"
    assert "fix_next_top" in f.str_list("free.mock_report_sections")
    # Owner flags stay unset (their feature or limit is off) until the owner sets them.
    for key in (
        "mock.offline_grace_s",
        "report.fix_next_count",
        "practice.weak_min_attempts",
        "daily.min_players_for_rank",
        "tutor.max_input_chars",
        "safety.helplines",
        "social.nickname_words",
        "xp.duel_per_correct",
    ):
        assert flag_registry.known(key), key
        assert f.get(key) is None, key
    assert f.bool("ai.llm_moderation") is False


def test_server_values_win_and_aliases_map_to_their_key() -> None:
    f = Flags({"league_promote_count": 3, "free.practice_questions_per_day": 10})
    assert f.int_or_none("league.promote_count") == 3
    assert f.int_or_none("free.practice_questions_per_day") == 10
    both = Flags({"league.promote_count": 9, "league_promote_count": 3})
    assert both.int_or_none("league.promote_count") == 9
