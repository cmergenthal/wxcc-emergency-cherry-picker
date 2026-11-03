# PHP deployment checklist

The application has been refactored to PHP + private JSON files, retaining the `sa-ds-voice-sdk` Web Component. This replaces the earlier Node/Docker checklist.

## Completed locally

- [x] Replace Express/Socket.io with PHP HTTP endpoints.
- [x] Add locked, atomic JSON storage with expiration and organization/interaction keys.
- [x] Preserve Web Component/Agent Desktop integration and direct Webex Claim calls.
- [x] Retry missing caller metadata and await saved transfer state.
- [x] Move public settings to runtime `config.js`.
- [x] Build the deployable `src/dist/` folder.
- [x] Pass JavaScript tests, concurrent PHP storage tests, PHP syntax checks, and local HTTP contract tests. HTTP identity calls are mocked; no live Webex credentials were used.

## Your hosting setup

Hosted base URL: https://widgets.example.com/cherry-picker/

The local Desktop layout and inbound flow now contain this hostname. `config.js` can keep its relative `./api/` setting.

- [ ] Confirm PHP 8.1+ and cURL are available; use a supported PHP release.
- [ ] Upload the **contents** of `src/dist/` to an HTTPS folder such as `/cherry-picker/`.
- [ ] Set `CHERRY_PICKER_ORG_ID` to the WxCC organization UUID.
- [ ] Set `CHERRY_PICKER_STORAGE_DIR` to a writable absolute path **outside the web document root**. PHP creates `callers.json` and `transfers.json` there.
- [ ] Set `CHERRY_PICKER_WEBHOOK_SECRET` to a random secret of at least 32 characters in the PHP hosting environment.
- [ ] If needed, copy deployed `api/config.example.php` to `api/config.local.php` and adjust `allowed_origins` to your Agent Desktop origin.
- [ ] Ensure your PHP host receives the `Authorization` request header and can call `https://webexapis.com/v1/people/me`.
- [ ] Edit deployed `config.js`: correct Webex API region; leave `apiBaseUrl: './api/'` for standard subfolder deployment. Keep Conference disabled for the initial Claim test.

## Webex setup

- [ ] Enable manual assignment on the test queue and manual telephony capacity 1 on the effective agent multimedia profile.
- [ ] Import `src/flow/GenericCherryPickerFlow.json`, select your queue/prompts, and set the webhook URL to `https://widgets.example.com/cherry-picker/api/webhook.php`.
- [ ] Add the flow HTTP header `X-Webhook-Secret` with your server-side secret. Validate and publish, then associate the flow with your test inbound number.
- [ ] Set `src/cherryPickerWidget.json`'s script to `https://widgets.example.com/cherry-picker/build/bundle.js`; upload/merge and assign the layout to the team.
- [ ] Sign in to Agent Desktop, confirm the widget and metadata requests work, and test inbound call → queue list → Claim → wrap-up.
- [ ] Confirm two agents cannot successfully claim the same Webex call.

## Optional Conference/Merge

- [ ] Set your wrap-up code and hold extension in `config.js`.
- [ ] Create/configure the hold/return flow, carrying the **original transfer task ID** into its POST to `api/transfer-hold.php`. The included flow is the inbound queue flow only.
- [ ] Add the same webhook secret header, use the returned attempt counter, and configure missing-state/timeout fallback handling.
- [ ] Verify the agent's Calling service/events work, enable Conference in `config.js`, and test hold → claim second caller → merge → recovery on failure.

Full commands, endpoint contracts, limitations, and troubleshooting are in [the PHP deployment guide](README.md).

## Optional emergency header

- [ ] Replace `widgets.example.com` with your hosting domain in `src/emergency-header-layout.json`.
- [ ] Set `emergencyQueueName` or `emergencyQueueId` in the deployed `config.js`, or in the header's layout properties. There is no built-in queue.
- [ ] Configure the wrap-up code ID and name before using one-click transfer and answer.
- [ ] Follow [the emergency header deployment guide](src/EMERGENCY-HEADER.md).
