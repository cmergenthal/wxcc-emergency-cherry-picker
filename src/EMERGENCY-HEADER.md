# Emergency queue header

A compact Web Component for Webex Contact Center Agent Desktop. It shows only the newest waiting voice contact in the configured queue and an **Answer** button. The newest contact is selected by `createdTime`, not by the time a contact's status was last updated.

When the agent is already on a voice call, **Answer** returns that call to its original/current routing queue, completes the configured wrap-up, claims the selected emergency contact, waits for that exact contact's offer, and requests WebRTC answer. With no current voice task, it claims and answers directly. No SQL or additional PHP endpoints are required.

## Deploy

1. Upload `dist/build/emergency-header.js` to:
   `https://widgets.example.com/cherry-picker/build/emergency-header.js`
Replace `widgets.example.com` in layout script URLs with your own hosting domain.

2. Merge these properties into your existing `/cherry-picker/config.js`. Keep your other settings. Use your real wrap-up code ID and its exact configured name:

   ```js
   emergencyQueueName: 'YOUR_QUEUE_NAME', // exact name; leave blank when using queue ID
   emergencyQueueId: '', // use a stable queue ID instead of the name if preferred
   emergencyTransferMode: 'original',
   emergencyTransferQueueId: '', // leave blank to return the current call to its queue
   wrapUpCodeId: 'YOUR_EXISTING_WRAP_UP_CODE_ID',
   transferWrapUpReason: 'YOUR_EXACT_WRAP_UP_CODE_NAME',
   webRtcEnabled: true,
   ```

   Configure at least one of `emergencyQueueName` or `emergencyQueueId`. There is no default queue. Queue IDs take precedence over names when both are supplied. A missing queue setting displays a configuration error and disables Answer.

   You can configure an individual header through its layout `properties` instead:

   ```json
   "properties": {
     "accessToken": "$STORE.auth.accessToken",
     "emergencyQueueName": "YOUR_QUEUE_NAME",
     "emergencyQueueId": ""
   }
   ```

   Nonblank queue properties in the layout override the shared settings in `config.js`. Blank layout fields use `config.js`. The name is used as the header label when provided. Reload Agent Desktop after changing either source.

   The header always completes wrap-up automatically when replacing an active call. It requires the code ID/name even if the full Cherry Picker's `autoWrapUpOnTransfer` option is false. Choose a code that accurately describes a queue transfer and is available to this agent. Configuration is checked before transferring.
3. Merge `emergency-header-layout.json` into the **`area`** object of the Desktop layout assigned to this agent. It contains an `area.header` fragment, not a complete replacement layout. If `area.header` already exists, add the `emergency` widget to its `widgets` and its existing layout row rather than replacing your other header widgets.
4. If your layout uses `area.advancedHeader`, use this component object in that existing array instead of adding `area.header` (Webex requires these header approaches to be used separately):

   ```json
   {
     "comp": "cmergent-emergency-header",
     "script": "https://widgets.example.com/cherry-picker/build/emergency-header.js?v=emergency-header-3",
     "properties": { "accessToken": "$STORE.auth.accessToken" },
     "attributes": { "style": "height:64px;display:flex;align-items:center;" }
   }
   ```

5. Save the layout and reload Agent Desktop after any active call finishes. The new bundle loads fresh runtime configuration on each page load.

Only the new `emergency-header.js` bundle and your configuration/layout edits are needed. Existing Cherry Picker PHP/JSON storage can remain as deployed.

## Queue discovery diagnostics

The header searches the most recent ten minutes first using `channelTypes=telephony`, a fixed `to` timestamp and `pageSize=1000`. If no emergency contact is found there, it searches the remaining configured lookback. Get Tasks is oldest-first. Full pages without a visible next link are continued by advancing the documented `from` creation-time boundary with a one-millisecond overlap; records are deduplicated. Timestamps that cannot advance, page limits and timeouts are reported as incomplete results rather than an empty queue.

Click the **i** button to inspect or copy a diagnostic report. It includes the build version, API origin, check time, request page counts, total task counts, target-queue statuses, and aggregate queue-name/status counts. It excludes caller numbers, task IDs and bearer tokens. When no emergency contact is found, the status line shows the number of voice tasks and target-queue tasks returned by Webex. The original Answer action and its errors are retained between polling updates.

See the [official Get Tasks specification](https://github.com/webex/webex-openapi-specs/blob/main/public-spec/webex-contact-center.json) for the ascending order and query parameters.

## Behavior and checks

- Queue name matching is exact and case-sensitive. Prefer `emergencyQueueId` when names can change. Nonwaiting and digital contacts are excluded. The default discovery window is 24 hours, configurable through `emergencyLookbackMs`; contacts created before that window are not shown. Polling runs every five seconds by default (`pollIntervalMs`, minimum five seconds).
- If no eligible contact is waiting, the button is disabled. Lookup errors disable Answer until a successful refresh. The small status line includes the full message in its tooltip.
- The click freezes the displayed contact ID. A newer arrival during the operation does not redirect the answer. The target is checked again before transfer and before Claim.
- The original queue ID is read from the active task's routing data. When that ID is missing, the operation stops before transferring; supply `emergencyTransferQueueId` only if a fixed fallback is appropriate. The widget refuses to send the existing call into the emergency queue.
- The call is transferred only once. Wrap-up is submitted only after transfer confirmation and a wrap-up task state/event. The next call is not claimed until the previous voice task disappears. Another incoming voice task, stale emergency call, failure, or timeout stops the operation with a status message.
- The emergency queue and multimedia profile must allow manual voice assignment, and the agent must be eligible for that queue. The original queue must be available as a transfer destination. These are the same tenant prerequisites as the existing Cherry Picker.
- Use Desktop/browser audio with microphone permission already granted. The SDK's `acceptWebRtcCall()` requests browser answer; its return value alone does not prove audio is connected. The widget shows **On call** after the matching Desktop assignment event. If automatic browser answering needs another user gesture or an offer is late, **Accept** retries only browser answer for the already claimed contact, never transfer or Claim.
- If Desktop auto-wrap-up has already cleared the original task, no duplicate wrap-up is submitted. Transfer, wrap-up, and Claim are not automatically retried on uncertain outcomes.
- Closing/reloading the widget cancels its polling and listeners, and stops subsequent actions. A transfer already confirmed by Webex cannot be undone. Avoid initiating a separate call operation in the full Cherry Picker while the header is connecting.
- On a live test, verify that the existing caller reaches its queue, the intended wrap-up code is recorded, the newest emergency caller connects with audio, and other agents cannot claim the same contact twice. Also verify an empty queue, another agent claiming the displayed contact, and a rejected transfer.

## References

- [Webex custom desktop layout and header widgets](https://help.webex.com/en-us/article/ng08gqeb)
- [Desktop tasks, WebRTC answer, and wrap-up methods](https://developer.webex.com/webex-contact-center/docs/desktop-call-control)
- [Desktop queue transfer methods](https://developer.webex.com/webex-contact-center/docs/desktop-transfers)
- [Webex cherry-pick voice tasks example](https://developer.webex.com/blog/cherry-pick-voice-tasks-in-webex-contact-center)
