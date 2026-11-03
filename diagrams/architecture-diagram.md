# PHP + JSON file architecture

```mermaid
sequenceDiagram
    participant Flow as Inbound WxCC Flow
    participant PHP as PHP endpoints
    participant JSON as Private JSON files
    participant Widget as Agent Desktop Web Component
    participant Webex as Webex APIs
    Flow->>PHP: POST webhook.php + webhook secret
    PHP->>JSON: Lock, expire, save caller metadata atomically
    loop Every 5 seconds
        Widget->>Webex: List tasks (agent token)
        Webex-->>Widget: Tasks and status
        Widget->>PHP: POST caller-ids.php (missing IDs + agent token)
        PHP->>Webex: Verify identity and organization
        PHP->>JSON: Read requested caller records under lock
        PHP-->>Widget: Found metadata / retryable misses
    end
    Widget->>Webex: Claim selected task
    opt Conference configured
        Widget->>PHP: POST transfer-state.php (hold)
        PHP->>JSON: Save original task ID and agent destination
        PHP-->>Widget: Saved acknowledgement
        Widget->>Webex: Transfer, wrap up, claim next task
        Widget->>PHP: POST transfer-state.php (merge)
        PHP->>JSON: Mark transfer ready
        Note over Flow,PHP: Separate hold/return flow polls transfer-hold.php with original task ID
        Flow->>PHP: Read readiness + webhook secret
        PHP-->>Flow: ready, agentNumber, attempt, timedOut
        Flow->>Webex: Return held caller when ready
        Widget->>Webex: Conference call legs using Calling API
    end
```

PHP serves individual requests; there is no persistent Node or Socket.io process. `callers.json` and `transfers.json` use separate stable lock files, atomic replacements, and expiry timestamps. Store them outside the web document root on the same local server.
