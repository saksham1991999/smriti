# Supabase spike checklist (IMPLEMENTATION_PLAN F-7)

The local stack stands in for Supabase Auth (`LocalAuthAdmin`, `/v1/dev/auth/*`). These are the calls `apps/api/smriti_api/services/auth_admin.py` (`SupabaseAuthAdmin`) and the apps make against a real project, and that nobody has run against one yet. The owner runs each request once against a **test** Supabase project and ticks the box with what came back. If any of 1 to 4 fails, auth flow §6.11 names the fallback (a per-child secret and a server-side password grant).

Set these in your shell first. Never paste the values into the repo or a ticket.

```sh
export SB_URL="https://<project-ref>.supabase.co"      # SUPABASE_URL
export SB_SERVICE="<service role key>"                  # SUPABASE_SERVICE_ROLE_KEY
export SB_ANON="<anon key>"                             # SUPABASE_ANON_KEY
export MANAGED_DOMAIN="managed.<auth-domain>"           # MANAGED_IDENTITY_DOMAIN
```

## 1. Create a managed child with a chosen id

`make_managed(adopt=False)`: the API picks the child's `user_id` and creates the identity with it.

```sh
CHILD_ID=$(uuidgen | tr 'A-Z' 'a-z')
curl -sS -X POST "$SB_URL/auth/v1/admin/users" \
  -H "apikey: $SB_SERVICE" -H "Authorization: Bearer $SB_SERVICE" -H "Content-Type: application/json" \
  -d "{\"id\":\"$CHILD_ID\",\"email\":\"$CHILD_ID@$MANAGED_DOMAIN\",\"email_confirm\":true,\"app_metadata\":{\"managed\":true}}"
```

- [ ] 200, and the returned `id` equals `$CHILD_ID`
- [ ] `email_confirmed_at` is set, and no email was sent (check Auth logs)
- [ ] `app_metadata.managed` is `true` and shows in the user's access token (step 4)

## 2. Turn an anonymous guest into a managed child, keeping its id

`make_managed(adopt=True)`: the guest who did onboarding on the parent's phone becomes the child (AUTH-24 adopt).

```sh
GUEST=$(curl -sS -X POST "$SB_URL/auth/v1/signup" -H "apikey: $SB_ANON" -H "Content-Type: application/json" -d '{}')
GUEST_ID=$(echo "$GUEST" | jq -r .user.id)
curl -sS -X PUT "$SB_URL/auth/v1/admin/users/$GUEST_ID" \
  -H "apikey: $SB_SERVICE" -H "Authorization: Bearer $SB_SERVICE" -H "Content-Type: application/json" \
  -d "{\"email\":\"$GUEST_ID@$MANAGED_DOMAIN\",\"email_confirm\":true,\"app_metadata\":{\"managed\":true}}"
```

(The empty-body signup needs anonymous sign-ins enabled in the project.)

- [ ] 200, the `id` is unchanged, and `is_anonymous` is now `false`
- [ ] The guest's old access token still verifies until it expires (or note what happens)

## 3. Mint a one-time token hash without sending mail

`session_token_hash`: `POST /v1/guardian/children/{id}/session` returns only this hash.

```sh
curl -sS -X POST "$SB_URL/auth/v1/admin/generate_link" \
  -H "apikey: $SB_SERVICE" -H "Authorization: Bearer $SB_SERVICE" -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"$CHILD_ID@$MANAGED_DOMAIN\"}" | jq '{hashed_token, properties}'
```

- [ ] A `hashed_token` comes back (top level or under `properties`; the API reads both)
- [ ] No email is sent (Auth logs, and the SMTP provider's log)
- [ ] Note the hash's lifetime as the project is configured (the flow assumes 5 minutes or less)

## 4. Exchange the hash for a child session on the device

What the apps do with supabase-js (locally `POST /v1/dev/auth/verify-otp`):

```ts
const { data, error } = await supabase.auth.verifyOtp({ token_hash: hashed_token, type: 'email' });
```

or the same over REST:

```sh
curl -sS -X POST "$SB_URL/auth/v1/verify" -H "apikey: $SB_ANON" -H "Content-Type: application/json" \
  -d "{\"type\":\"email\",\"token_hash\":\"<hashed_token from step 3>\"}"
```

- [ ] A session comes back for `$CHILD_ID` (`user.id`), with `access_token` and `refresh_token`
- [ ] Using the same hash again fails
- [ ] Using a hash after the lifetime in step 3 fails
- [ ] The access token's `amr` and `app_metadata` are as the API expects (paste the decoded claims, not the token)
- [ ] Record the supabase-js version used

## 5. Block public email sign-ups with the "before user created" hook

Email sign-in stays enabled only for the internal identities (auth flow §6.11 and §12). Configure the hook in the dashboard (Authentication, Hooks, "Before user created") with a function that rejects any email not on `$MANAGED_DOMAIN`, then:

```sh
# A public sign-up with an ordinary address: must be refused.
curl -sS -X POST "$SB_URL/auth/v1/signup" -H "apikey: $SB_ANON" -H "Content-Type: application/json" \
  -d '{"email":"someone@example.com","password":"<random>"}'
# An OTP to an ordinary address: must be refused.
curl -sS -X POST "$SB_URL/auth/v1/otp" -H "apikey: $SB_ANON" -H "Content-Type: application/json" \
  -d '{"email":"someone@example.com","create_user":true}'
```

- [ ] Both are refused, and no user row appears
- [ ] Step 1 still works with the hook on (find out whether admin creation runs the hook; if it does, the hook must allow `$MANAGED_DOMAIN`)
- [ ] Google and Apple sign-in still create users with the hook on
- [ ] Anonymous sign-in (step 2's empty signup) still works with the hook on

## 6. The managed domain never receives mail

```sh
dig +short MX "$MANAGED_DOMAIN"
```

- [ ] The answer is the null MX record `0 .` (RFC 7505)
- [ ] There is no A or AAAA record that would take mail by fallback, or note what exists

## 7. Account deletion and sign-out

Used by account deletion and `DELETE /v1/guardian/children/{id}`.

```sh
curl -sS -X POST "$SB_URL/auth/v1/logout?scope=global" -H "apikey: $SB_ANON" -H "Authorization: Bearer <child access token>"
curl -sS -X DELETE "$SB_URL/auth/v1/admin/users/$CHILD_ID" -H "apikey: $SB_SERVICE" -H "Authorization: Bearer $SB_SERVICE"
```

- [ ] Logout answers 204, and the child's refresh token no longer works
- [ ] Delete answers 200, and rows that reference `auth.users` cascade as `docs/DB_SCHEMA.md` says

## After the spike

Write the results (pass or fail per box, the supabase-js version, and any difference from what is written here) into `DECISIONS.md` as a new ruling, then set `MANAGED_IDENTITY_DOMAIN` in Railway. If step 3 or 4 fails, switch to the fallback before AUTH-24 ships.
