<?php
$url = 'https://www.tsn.ca/mlb/article/2025-mlb-on-tsn-schedule/';
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
$html = curl_exec($ch);
curl_close($ch);

if (!$html) {
    die("Failed to fetch\n");
}

$dom = new DOMDocument();
libxml_use_internal_errors(true);
$dom->loadHTML($html);
libxml_clear_errors();
$xpath = new DOMXPath($dom);

echo "--- TABLES ---\n";
$tables = $xpath->query('//table');
if ($tables->length > 0) {
    echo "Found " . $tables->length . " tables.\n";
    foreach ($tables as $t) {
        $rows = $xpath->query('.//tr', $t);
        foreach ($rows as $r) {
            $cols = $xpath->query('.//td', $r);
            $rowStr = [];
            foreach ($cols as $c) {
                $rowStr[] = trim($c->textContent);
            }
            echo implode(" | ", $rowStr) . "\n";
        }
    }
} else {
    echo "No tables found.\n";
}

echo "\n--- PARAGRAPHS ---\n";
$paragraphs = $xpath->query('//div[contains(@class, "article__content")]//p');
if ($paragraphs->length > 0) {
    foreach ($paragraphs as $p) {
        echo trim($p->textContent) . "\n";
    }
} else {
    echo "No paragraphs found in article content.\n";
}
?>
