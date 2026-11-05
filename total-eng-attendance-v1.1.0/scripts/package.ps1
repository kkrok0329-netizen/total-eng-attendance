$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$archivePath = Join-Path $outputDirectory 'total-eng-attendance-v1.1.0.zip'
$names = @('package.json', 'Dockerfile', 'compose.yaml', 'Caddyfile', 'render.yaml', 'GITHUB_UPLOAD_GUIDE.txt', '.env.example', '.gitignore', '.dockerignore', 'README.md', 'DEPLOY.md', 'TEST_REPORT.md', 'public', 'server', 'scripts', 'test')
$sourcePaths = $names | ForEach-Object { Join-Path $projectRoot $_ }
Compress-Archive -LiteralPath $sourcePaths -DestinationPath $archivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    if ($entries | Where-Object { $_ -match '(^|/)(\.env|data|backups|\.git)(/|$)' }) { throw 'Archive contains private files.' }
    foreach ($required in @('.env.example', '.dockerignore', 'public/index.html', 'public/app.js', 'server/app.mjs', 'DEPLOY.md')) {
        if ($entries -notcontains $required) { throw "Archive is missing $required" }
    }
    $localEnvironment = Join-Path $projectRoot '.env'
    if (Test-Path -LiteralPath $localEnvironment) {
        $environmentText = [IO.File]::ReadAllText($localEnvironment)
        $secretValues = @([regex]::Matches($environmentText, '(?m)^(?:ADMIN_PASSWORD|DATA_ENCRYPTION_KEY)=(.+)$') | ForEach-Object { $_.Groups[1].Value.Trim() })
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match '\.(?:mjs|js|json|html|md|txt|ps1|yaml|example)$') {
                $reader = [IO.StreamReader]::new($entry.Open())
                try { $entryText = $reader.ReadToEnd() } finally { $reader.Dispose() }
                foreach ($secretValue in $secretValues) {
                    if ($secretValue.Length -ge 8 -and $entryText.Contains($secretValue)) { throw 'Archive contains a local runtime secret.' }
                }
            }
        }
    }
    Write-Output "ZIP verified: $($entries.Count) entries"
} finally {
    $archive.Dispose()
}
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256 | Select-Object Hash, Path
