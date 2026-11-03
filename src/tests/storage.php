<?php
declare(strict_types=1);
require __DIR__ . '/../api/store.php';
function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
if (($argv[1] ?? '') === 'worker') {
    for ($i = 0; $i < 40; $i++) {
        store_transaction($argv[2], 'callers', function (&$records) {
            $records['counter'] = ['expiresAt' => time() + 3600, 'value' => ($records['counter']['value'] ?? 0) + 1];
        });
    }
    exit;
}
$dir = sys_get_temp_dir() . '/cherry-picker-test-' . bin2hex(random_bytes(6));
mkdir($dir, 0700);
try {
    $processes = [];
    for ($i = 0; $i < 6; $i++) {
        $processes[] = proc_open([PHP_BINARY, __FILE__, 'worker', $dir], [0 => ['file', '/dev/null', 'r'], 1 => STDOUT, 2 => STDERR], $pipes);
    }
    foreach ($processes as $process) check(proc_close($process) === 0, 'Worker failed');
    $records = json_decode(file_get_contents($dir . '/callers.json'), true, 512, JSON_THROW_ON_ERROR);
    check($records['counter']['value'] === 240, 'Concurrent writes were lost');
    store_transaction($dir, 'callers', function (&$records) {
        $records['expired'] = ['expiresAt' => time() - 1];
    });
    store_transaction($dir, 'callers', function (&$records) { check(!isset($records['expired']), 'Expired data retained'); });
    check(record_key('org-a', 'call') !== record_key('org-b', 'call'), 'Organization collision');
    $before = file_get_contents($dir . '/callers.json');
    try {
        store_transaction($dir, 'callers', function (&$records) { $records = []; throw new DomainException('abort'); });
    } catch (DomainException $e) {}
    check(file_get_contents($dir . '/callers.json') === $before, 'Failed operation changed disk');
    file_put_contents($dir . '/callers.json', '{broken');
    try {
        store_transaction($dir, 'callers', function (&$records) { $records = []; });
        throw new RuntimeException('Corrupt JSON accepted');
    } catch (JsonException $e) {}
    check(file_get_contents($dir . '/callers.json') === '{broken', 'Corrupt data overwritten');
    echo "PASS: concurrent writes, expiration, organization isolation, rollback, corrupt-file protection\n";
} finally {
    foreach (glob($dir . '/*') as $file) unlink($file);
    rmdir($dir);
}
