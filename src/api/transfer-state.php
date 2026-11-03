<?php
require_once __DIR__ . '/common.php';
endpoint(function (array $config, array $body) {
    $owner = agent_auth($config);
    $id = required_string($body, 'transferTaskId');
    $command = required_string($body, 'command');
    if (!in_array($command, ['transfer-hold', 'transfer-merge'], true)) respond(400, ['error' => 'Invalid command']);
    $number = required_string($body, 'number');
    $agentNumber = required_string($body, 'agentNumber');
    return store_transaction($config['storage_dir'], 'transfers', function (&$records) use ($config, $id, $command, $number, $agentNumber, $owner) {
        $key = record_key($config['org_id'], $id);
        $old = $records[$key] ?? null;
        if ($old && $old['owner'] !== $owner) throw new DomainException('Transfer owner mismatch');
        if ($command === 'transfer-merge' && !$old) throw new DomainException('Hold state missing or expired');
        // Hold retries are idempotent: never reset a transfer already marked ready.
        $records[$key] = $old ?? ['owner' => $owner, 'number' => $number, 'agentNumber' => $agentNumber,
            'transferTaskId' => $id, 'ready' => false, 'expiresAt' => time() + $config['transfer_ttl']];
        if ($command === 'transfer-merge') $records[$key]['ready'] = true;
        return ['ok' => true, 'transferTaskId' => $id];
    });
});
