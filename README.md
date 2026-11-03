# WxCC Emergency Cherry Picker

Independent project with the full Cherry Picker widget, configurable emergency header widget, PHP backend, and JSON file storage. See [the emergency header guide](src/EMERGENCY-HEADER.md), [deployment checklist](SETUP-CHECKLIST.md), and [source attribution](NOTICE.md).

## Use Case Overview

A Webex Contact Center Agent Desktop Web Component (`sa-ds-voice-sdk`) lists voice tasks and lets agents claim a selected call. Optional Conference/Merge retains the sample's Webex Calling integration and adds persistent hold/merge state.

This local version replaces Express, Socket.io, and the in-memory cache with PHP endpoints and two private JSON files. It is intended for a small deployment on one PHP webserver. Allow time for tenant setup and live call testing; those steps cannot be completed by building the widget alone.

## Architecture

- Your webserver serves the JavaScript bundle, runtime `config.js`, and images.
- The inbound Webex Flow posts caller metadata to `api/webhook.php` with an `X-Webhook-Secret` header.
- The widget polls the Webex Tasks API every five seconds and fetches missing caller metadata from `api/caller-ids.php`. Failed/missing enrichment is retried without blocking the task list.
- `callers.json` and `transfers.json` live outside the public document root. Every operation takes a stable lock, removes expired records, and writes changes through a temporary file and rename. Corrupt data produces an error rather than being overwritten.
- Agent-facing PHP endpoints validate the agent bearer token with Webex `GET /v1/people/me` and check organization membership. Tokens are not stored. This requires the Desktop token to support that API; verify it in your tenant.
- Webex remains responsible for call assignment. JSON files store metadata and transfer coordination, not ownership of the actual Webex task.

See [the diagram](diagrams/architecture-diagram.md).

## Prerequisites

- PHP 8.1+ with JSON and cURL, outbound HTTPS to `webexapis.com`, and a writable private directory on a local filesystem supporting `flock` and atomic rename. Use a currently supported PHP release on the host.
- HTTPS hosting reachable from both Agent Desktop and the Webex Flow. No Node server, Docker, SQL, WebSocket server, Composer, or background worker is required.
- Node/npm on the build machine only. This package was built locally with Node 18.19.0; use an LTS Node release for ongoing development.
- WxCC administrator access, a test entry point/number, queue, agent/team, and multimedia profile allowing manual telephony assignment.
- A server-only random webhook secret (at least 32 characters).
- For Conference/Merge: a valid wrap-up code, a hold destination, and a hold/return flow able to correlate the **original transfer task ID**. The agent's Webex Calling service must provide the call events used by the sample.

## Code Scaffold

```text
src/
  widget-SDK-Voice.js       Existing Web Component and Desktop SDK integration
  transport.js             Authenticated PHP requests and late metadata handling
  public/config.js         Public runtime settings; no secrets
  api/
    config.example.php     Copy to config.local.php on the server if needed
    common.php             Input validation, CORS, Webex identity verification
    store.php              Locked JSON transactions and expiration cleanup
    webhook.php            Flow caller-metadata POST
    caller-ids.php          Widget metadata lookup POST
    transfer-state.php      Widget hold/merge POST
    transfer-hold.php       Hold-flow readiness POST
  scripts/package.mjs      Packages public files into dist/
  tests/                   Storage, HTTP, transport, and component lifecycle checks
  flow/GenericCherryPickerFlow.json
  cherryPickerWidget.json
  dist/                    Built uploadable application (gitignored)
```

Only upload the **contents of `src/dist/`**. Do not upload the source checkout or the private data directory. The packager excludes tests, dependencies, local configuration, and private storage.

## Deployment Guide

### 1. Build locally

```bash
git clone https://github.com/cmergenthal/wxcc-emergency-cherry-picker.git
cd wxcc-emergency-cherry-picker/src
npm ci
npm run build
```

Upload `dist/` contents into your desired HTTPS folder, for example `https://example.com/cherry-picker/`. Build output is generated locally and is not committed to this repository.

### 2. Configure public settings

Edit the deployed `config.js` (or `public/config.js` before building):

```js
window.CHERRY_PICKER_CONFIG = {
  apiBaseUrl: './api/',
  wxccApiBaseUrl: 'https://api.wxcc-us1.cisco.com',
  wrapUpCodeId: '',
  holdExtension: '',
  conferenceEnabled: false,
  pollIntervalMs: 5000
};
```

The relative API URL resolves against `config.js`, so subfolder hosting works. Change the regional API URL if needed. Runtime changes require a Desktop reload/cache refresh, not a rebuild. Keep Conference disabled until the hold flow and Calling integration are validated.

### 3. Configure PHP and private storage

Set these server environment variables through your hosting configuration:

```text
CHERRY_PICKER_ORG_ID=your-wxcc-organization-uuid
CHERRY_PICKER_STORAGE_DIR=/home/your-account/private/cherry-picker
CHERRY_PICKER_WEBHOOK_SECRET=a-random-secret-at-least-32-characters-long
```

Generate a secret locally with `php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'` and store it only in your PHP hosting environment and the Webex Flow's protected credential configuration.

If you need to change CORS or TTL settings, copy deployed `api/config.example.php` to `api/config.local.php` and edit it. `org_id` and `storage_dir` can also be set there; keep the secret supplied through `getenv`. The PHP process must be able to create/write the private directory. Never put JSON files under `public_html`, `htdocs`, or the application's public folder. The backend refuses storage under its detected document root.

Set `allowed_origins` to your actual Agent Desktop origin. Ensure the host forwards the `Authorization` header to PHP (some Apache/FastCGI configurations need that enabled). Each metadata/state request verifies the bearer token with Webex. A 401 means token/header issues; 403 means organization or origin mismatch; 503 means the Webex identity service could not be used; 500 means configuration/storage failure.

For Apache hosts such as DreamHost, upload the hidden `dist/api/.htaccess` file to `cherry-picker/api/.htaccess`. It sets `CGIPassAuth On` so PHP receives the Authorization header. If that server file already exists, add the directive to it instead of replacing its other settings. See [Apache CGIPassAuth documentation](https://httpd.apache.org/docs/2.4/mod/core.html#cgipassauth). An `Agent bearer token required` response means PHP did not receive an acceptable bearer header; check whether the failed browser request includes `Authorization: Bearer …` without sharing the token. This differs from `Webex rejected agent credentials`, which means the identity check rejected the supplied token.

### 4. Configure manual assignment

Read/save the existing queue and effective multimedia profile. Enable the queue's `manuallyAssignable` flag and set the profile's manual telephony capacity to 1, preserving other media settings. Apply the profile to the test agent/team and confirm queue access. Use the current regional API documentation for full update bodies.

Webex's [Cherry-Pick Voice Tasks guide](https://developer.webex.com/blog/cherry-pick-voice-tasks-in-webex-contact-center) explains the queue and profile requirement.

### 5. Import the inbound flow

Import `flow/GenericCherryPickerFlow.json`, choose your queue and prompts, and set the HTTP Request URL to:

```text
https://example.com/cherry-picker/api/webhook.php
```

The template uses `https://{{HOSTNAME}}/api/webhook.php`; replace the complete URL for subfolder hosting. Add the HTTP header `X-Webhook-Secret` using your configured secret. This header is not embedded in the downloadable flow file. Preserve `InteractionId`, `OrgId`, `ANI`, `DNIS`, and `Headers` in the JSON body. If raw SIP provider quotes produce malformed JSON, use text/plain with the sample body; PHP applies its compatibility normalization only to that fallback format.

Validate, publish, and assign the flow to your entry point/inbound routing. Confirm the webhook returns HTTP 200.

### 6. Install the Web Component

In `cherryPickerWidget.json`, set the widget script to:

```text
https://example.com/cherry-picker/build/bundle.js
```

Upload/merge the layout and assign it to the test team. Preserve the `accessToken` and `outdialEp` property bindings. Sign out/in and open Cherry Picker. Verify bundle/config/image loading, successful Tasks requests, and successful PHP metadata requests.

### 7. Test Claim

Call the test number, wait for the next poll, and claim the call as an eligible agent. Verify caller details, delivery, wrap-up, and two-agent contention. Metadata arriving after initial task discovery should appear on a later poll. A PHP metadata outage should show an error while leaving task discovery and Claim available.

### Browser/WebRTC answering (SDK 3.0.1)

The widget now uses Desktop SDK 3.0.1 and awaits SDK initialization. After a successful Claim, it shows **Accept browser call**. Click this when the call arrives; the widget checks that the claimed ID is the single current voice task in Desktop, then calls `Desktop.actions.acceptWebRtcCall()`.

The installed SDK dispatches `ax-web-call-answer`; it does not return confirmation that audio connected. The UI reports the answer request and asks you to confirm the native call timer/audio. If the claimed task is missing or multiple voice tasks are present, no answer request is sent. The control expires after 60 seconds and is cleared on end/wrap-up or widget removal. It does not automatically answer on Claim.

Upload the updated `dist/build/bundle.js` only, preserve your deployed PHP configuration, and use `https://widgets.example.com/cherry-picker/build/bundle.js?v=webrtc-sdk-3-1` in the Desktop layout to bypass the older cached bundle. Browser answering is enabled unless runtime config explicitly sets `webRtcEnabled: false`. Keep Conference disabled during this test. This migration uses the supported `Desktop.actions.getToken()` for task/metadata requests.

Local tests cover the answer guards and the installed SDK's dispatched event; live WebRTC audio and native Desktop behavior remain to be verified in your tenant.

### Minimal emergency header

The separate `cmergent-emergency-header` Web Component displays the newest waiting contact from a queue configured by name or ID in runtime settings or layout properties. One click returns the current call to its original queue, completes configured wrap-up, claims the selected emergency contact and requests WebRTC answer when that exact offer arrives. It also works when no call is active. The compact **Accept** fallback retries browser answer when a browser gesture is required. See [header deployment and configuration](src/EMERGENCY-HEADER.md) and the [Desktop layout fragment](src/emergency-header-layout.json). The build produces `dist/build/emergency-header.js` alongside the existing bundle. Live audio and transfer verification in your tenant is required.

### Transfer the active call to a selected queue and pick another

While the agent has a voice task, the widget shows **Send active call to** and loads the agent's voice queues through `Desktop.agentContact.vteamList` using the signed-in agent's profile and session. The widget reads the nested SDK response and filters out digital queues and entry points. Select a queue, then click **Transfer & pick** beside the queued caller you want next.

The widget verifies the active task and picked call, then calls `Desktop.agentContact.vteamTransferV2` with the selected queue ID and `destinationType: 'queue'`. Only a confirmed `AgentVteamTransferred` response proceeds. It waits for the old voice task to leave Desktop, including any wrap-up you must complete in the native interface (up to 90 checks, one second apart). It rechecks the picked call and available voice task slot, claims the call, and shows the existing **Accept browser call** control. It never automatically answers.

No hold extension, PHP changes, or Conference setup is required. Queue access and transfer permissions are determined by Webex. If no queues appear, check the agent's Desktop profile queue permissions and use **Refresh queues**. Queue IDs come from the Desktop queue list.

Runtime `config.js` is requested with a fresh query parameter on each page load so long-lived host JavaScript caching does not hide configuration changes. Reload Agent Desktop after editing config.

To complete wrap-up automatically for **Transfer & pick**, add these settings to your existing hosted `config.js`:

```js
autoWrapUpOnTransfer: true,
wrapUpCodeId: 'YOUR_WRAP_UP_CODE_ID',
transferWrapUpReason: 'EXACT_WRAP_UP_CODE_NAME',
```

Use a wrap-up code available to this agent that accurately describes the transfer. Configuration is checked before transferring. After transfer confirmation, the widget waits for the original task's wrap-up state or its `eAgentWrapup` event, submits `Desktop.agentContact.wrapupV2` once, requires `AgentWrappedUp`, and still waits for the old task to clear before claiming. If native auto wrap-up already removed the task, no wrap-up request is sent. A failed or timed-out wrap-up stops the sequence with instructions to finish manually; it is never retried automatically. Without `autoWrapUpOnTransfer: true`, existing manual wrap-up behavior remains. See [SDK wrapupV2](https://developer.webex.com/webex-contact-center/docs/desktop). Upload the new bundle and edit your existing config rather than overwriting other host-specific settings.

A successful transfer cannot be undone by this widget. If the picked call disappears, another voice task arrives, wrap-up remains unfinished, or Claim fails, the first caller remains transferred and the UI reports why the sequence stopped. Calls are not reserved between verification and Claim; Webex remains the authority on assignment. A timed-out transfer is not retried automatically.

Successful queue lists are retained in page memory for up to 30 minutes for the current bearer identity. This allows a recreated component to keep displaying queues when answering a call clears the Desktop queue cache and the SDK has no session ID. A changed bearer token, known profile/session change, confirmed empty queue response, or rejected queue request prevents reuse. A full page reload clears this fallback; transfer authorization remains enforced by Webex.

SDK 3.0.1 may leave `latestData.agentSessionId` empty when the widget loads after sign-in. The widget also captures session IDs from the documented agent state/relogin events, including `eAgentChannelStateChanged`. If the session ID is missing, finish the current call and wrap-up, then manually change voice availability with this widget loaded and refresh queues. The widget never changes agent availability automatically. See the [Desktop SDK event documentation](https://developer.webex.com/webex-contact-center/docs/desktop).

Deployment: replace only `build/bundle.js` and set the Desktop layout URL to `https://widgets.example.com/cherry-picker/build/bundle.js?v=queue-transfer-7`. Preserve your existing server configuration and `config.js`. Live queue-transfer and audio testing in your tenant remains required.

### 8. Configure optional Conference/Merge

Set `holdExtension`, `wrapUpCodeId`, and `conferenceEnabled: true` after completing the hold flow. The widget awaits PHP's successful `transfer-state.php` response before transferring the current call, wrapping it up, and claiming the new call. Merge saves `ready: true` through the same PHP endpoint.

The hold flow must POST to `api/transfer-hold.php` with `X-Webhook-Secret`:

```json
{ "transferTaskId": "ORIGINAL-WXCC-INTERACTION-ID", "attempt": 0 }
```

Example response:

```json
{ "ready": false, "timedOut": false, "found": true, "attempt": 1, "agentNumber": "1000" }
```

While not ready, play a hold segment and poll again using the returned `attempt`. When ready and an agent number is present, return the held call to that number. After the configured maximum attempts (default 5), an existing record becomes ready for fallback return. A missing/expired record never returns ready: if `timedOut` is true with `found` false, follow a deliberate fallback route instead of continuing indefinitely.

**The supplied JSON is the inbound queue flow, not the hold/return flow.** Correlation must carry the original task ID into your hold flow; a new contact's ID may differ. Phone-number-only lookup is intentionally absent because simultaneous calls from one number could return to the wrong agent. Configure that correlation in your tenant and test it before enabling Conference. The existing browser Calling event/conference logic remains dependent on the Desktop SDK internals used by the upstream sample.

## Known Limitations

- Local tests pass; no live Webex tenant, credentials, hold destination, or hosting account was supplied, so live authentication, flow import, Claim, and Conference are not certified by these tests.
- The backend authenticates organization membership; it does not independently enforce per-queue caller-metadata permissions. It returns only explicitly requested task IDs. Webex enforces actual task assignment permissions.
- Flat-file storage is for a single server with modest traffic. Operations serialize per file; use a different storage layer for multiple hosts or higher sustained load.
- Expired records are removed on the next request to their store. No background cleanup runs when the app is idle.
- Call discovery uses the inherited 10-minute Tasks query window. Long-waiting tasks and pagination need validation against your tenant/workload.
- The upstream Conference/Merge integration accesses internal Calling SDK objects. It stays optional and disabled by default. This PHP refactor does not supply missing tenant telephony configuration.
- The bundle includes the Desktop SDK and produces webpack size advisory warnings (~341 KiB). It compiles successfully.
- Adapted from [WebexPlaybooks](https://github.com/webex/WebexPlaybooks/tree/main/playbooks/wxcc-voice-cherry-picker) and [wxsd-sales/wxcc-voice-cherry-picker](https://github.com/wxsd-sales/wxcc-voice-cherry-picker). See [LICENSE](LICENSE), the preserved [upstream MIT license](licenses/wxcc-voice-cherry-picker-MIT.txt), and [NOTICE.md](NOTICE.md). This is a demonstration, not a production-hardening claim.

### Validation

```bash
npm test
php tests/storage.php
python3 tests/http_endpoints.py
npm run build
```

Storage tests exercise six concurrent writers, TTL cleanup, failed-operation rollback, and corrupt-file preservation. HTTP tests run an actual local PHP server with **mocked upstream Webex identity**, covering auth/CORS/validation, late metadata, ownership, idempotency, and hold behavior. The component test uses a mocked DOM/Desktop SDK to check startup and cleanup without Socket.io or Calling. Live browser/tenant testing remains required.
