<?php
declare(strict_types=1);
require_once __DIR__ . '/store.php';

function respond(int $status, $body): void {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function configuration(): array {
    $file = __DIR__ . '/config.local.php';
    $config = require (is_file($file) ? $file : __DIR__ . '/config.example.php');
    if (!is_array($config) || empty($config['org_id']) || empty($config['storage_dir']) ||
        strlen($config['webhook_secret'] ?? '') < 32) {
        throw new RuntimeException('Configure organization, private storage, and webhook secret');
    }
    $directory = $config['storage_dir'];
    if ($directory[0] !== '/' || str_contains($directory, '..')) {
        throw new RuntimeException('Storage must be an absolute private path');
    }
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create private storage');
    }
    $directory = realpath($directory);
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? '') ?: realpath(__DIR__ . '/..');
    if ($directory === false || $directory === $root || str_starts_with($directory, $root . '/')) {
        throw new RuntimeException('Storage must be outside document root');
    }
    $config['storage_dir'] = $directory;
    return $config;
}

function input_body(): array {
    $raw = file_get_contents('php://input', false, null, 0, 65537);
    if ($raw === false || strlen($raw) > 65536) respond(413, ['error' => 'Request too large']);
    try {
        // Preserve valid JSON. Only normalize the upstream flow's malformed provider quotes on fallback.
        try { $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
        catch (JsonException $e) {
            if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'text/plain')) throw $e;
            $body = json_decode(preg_replace('/provider="([^"]*)"/', 'provider=$1', $raw), true, 32, JSON_THROW_ON_ERROR);
        }
    } catch (JsonException $e) { respond(400, ['error' => 'Invalid JSON']); }
    if (!is_array($body) || !str_starts_with(ltrim($raw), '{')) respond(400, ['error' => 'Expected JSON object']);
    return $body;
}

function required_string(array $body, string $key, int $limit = 256): string {
    $value = $body[$key] ?? null;
    if (!is_string($value) || trim($value) === '' || strlen($value) > $limit) {
        respond(400, ['error' => 'Invalid ' . $key]);
    }
    return $value;
}

function flow_auth(array $config): void {
    if (!hash_equals($config['webhook_secret'], $_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? '')) {
        respond(401, ['error' => 'Invalid webhook credentials']);
    }
}

function normalize_org(string $id): string {
    $decoded = base64_decode($id, true);
    if ($decoded !== false && preg_match('~/ORGANIZATION/([^/]+)$~', $decoded, $match)) return strtolower($match[1]);
    return strtolower($id);
}

/** Validate the signed-in user's bearer token with Webex; never persist tokens. */
function agent_auth(array $config): string {
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer [^\s]+$/', $authorization) || strlen($authorization) > 8192) {
        respond(401, ['error' => 'Agent bearer token required']);
    }
    if (!function_exists('curl_init')) throw new RuntimeException('PHP cURL extension required');
    $curl = curl_init('https://webexapis.com/v1/people/me');
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: ' . $authorization],
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10]);
    $raw = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    if ($raw === false || $status >= 500 || $status === 429) respond(503, ['error' => 'Webex identity check unavailable']);
    if ($status !== 200) respond(401, ['error' => 'Webex rejected agent credentials']);
    $person = json_decode($raw, true);
    if (!is_array($person) || empty($person['id']) || empty($person['orgId']) ||
        normalize_org($person['orgId']) !== normalize_org($config['org_id'])) {
        respond(403, ['error' => 'Agent organization does not match']);
    }
    return $person['id'];
}

function endpoint(callable $handler): void {
    try {
        $config = configuration();
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '') {
            if (!in_array($origin, $config['allowed_origins'], true)) respond(403, ['error' => 'Origin not allowed']);
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Webhook-Secret');
            header('Access-Control-Allow-Methods: POST, OPTIONS');
        }
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') respond(204, null);
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            header('Allow: POST, OPTIONS');
            respond(405, ['error' => 'POST required']);
        }
        $body = input_body();
        $result = $handler($config, $body);
        respond(200, $result);
    } catch (DomainException $e) {
        respond(409, ['error' => $e->getMessage()]);
    } catch (Throwable $e) {
        // Do not log caller payloads, bearer tokens, or local paths to the client.
        error_log('Cherry Picker: ' . get_class($e));
        respond(500, ['error' => 'Server configuration or storage error']);
    }
}
