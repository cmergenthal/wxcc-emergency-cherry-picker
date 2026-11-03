<?php
declare(strict_types=1);

/** One stable lock file per store: never lock the JSON inode that rename replaces. */
function store_transaction(string $directory, string $name, callable $operation) {
    if (!in_array($name, ['callers', 'transfers'], true)) {
        throw new RuntimeException('Unknown store');
    }
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create storage directory');
    }
    $path = $directory . '/' . $name . '.json';
    $lock = fopen($path . '.lock', 'c');
    if ($lock === false) throw new RuntimeException('Cannot open storage lock');
    $temporary = null;
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock storage');
        $records = [];
        if (file_exists($path)) {
            $raw = file_get_contents($path);
            if ($raw === false) throw new RuntimeException('Cannot read storage');
            $decoded = json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
            if (!$decoded instanceof stdClass) throw new RuntimeException('Invalid storage format');
            $records = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        }
        $before = $records;
        foreach ($records as $key => $record) {
            if (!is_array($record) || !isset($record['expiresAt'])) {
                throw new RuntimeException('Invalid storage record');
            }
            if ($record['expiresAt'] <= time()) unset($records[$key]);
        }
        $result = $operation($records);
        if ($records !== $before || !file_exists($path)) {
            $json = json_encode((object)$records, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            $temporary = tempnam($directory, $name . '-');
            if ($temporary === false) throw new RuntimeException('Cannot create storage temporary file');
            chmod($temporary, 0600);
            if (file_put_contents($temporary, $json) !== strlen($json)) {
                throw new RuntimeException('Cannot write storage');
            }
            if (!rename($temporary, $path)) throw new RuntimeException('Cannot replace storage');
            $temporary = null;
        }
        return $result;
    } finally {
        if ($temporary !== null && is_file($temporary)) unlink($temporary);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function record_key(string $orgId, string $interactionId): string {
    return hash('sha256', $orgId . "\0" . $interactionId);
}
