# ============================================================
# FKI 설문 시스템 — Cloudflare Pages 배포
#
#   .\deploy.ps1
#
# .env.deploy 에서 값을 읽어 Pages 프로젝트를 만들고 배포한 뒤
# 환경변수를 등록한다. 비밀값은 화면에 출력하지 않는다.
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$PROJECT = 'fki-survey'
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.deploy'

if (-not (Test-Path $envFile)) {
  Write-Host "[!] $envFile 이 없습니다. DEPLOY.md 3단계를 먼저 진행하세요." -ForegroundColor Red
  exit 1
}

# --- .env.deploy 파싱 (값은 절대 출력하지 않는다) ---
$cfg = @{}
Get-Content $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
    $i = $line.IndexOf('=')
    $cfg[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
  }
}

# AUTH_SECRET 이 비어 있으면 만들어서 파일에 채워 넣는다.
if (-not $cfg['AUTH_SECRET']) {
  $cfg['AUTH_SECRET'] = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
  Add-Content $envFile "`nAUTH_SECRET=$($cfg['AUTH_SECRET'])" -Encoding UTF8
  Write-Host "[+] AUTH_SECRET 을 새로 생성해 .env.deploy 에 저장했습니다."
}

$required = 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'AUTH_SECRET'
$missing = $required | Where-Object { -not $cfg[$_] }
if ($missing) {
  Write-Host "[!] .env.deploy 에 다음 값이 비어 있습니다: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}

if ($cfg['ADMIN_PASSWORD'].Length -lt 10) {
  Write-Host "[!] ADMIN_PASSWORD 가 너무 짧습니다. 관리자 화면에서는 응답자 이름까지 내려받을 수 있으니 긴 값을 권합니다." -ForegroundColor Yellow
}

if ($cfg['CLOUDFLARE_API_TOKEN']) { $env:CLOUDFLARE_API_TOKEN = $cfg['CLOUDFLARE_API_TOKEN'] }
if ($cfg['CLOUDFLARE_ACCOUNT_ID']) { $env:CLOUDFLARE_ACCOUNT_ID = $cfg['CLOUDFLARE_ACCOUNT_ID'] }

# --- 프로젝트 생성 (이미 있으면 통과) ---
Write-Host "`n[1/3] Pages 프로젝트 확인"
$list = npx wrangler pages project list 2>&1 | Out-String
if ($list -notmatch [regex]::Escape($PROJECT)) {
  npx wrangler pages project create $PROJECT --production-branch main
} else {
  Write-Host "      '$PROJECT' 이미 존재 — 건너뜁니다."
}

# --- 환경변수 등록 (stdin 으로 전달해 명령행에 남기지 않는다) ---
Write-Host "`n[2/3] 환경변수 등록"
foreach ($key in $required) {
  $cfg[$key] | npx wrangler pages secret put $key --project-name $PROJECT | Out-Null
  Write-Host "      $key 등록 완료"
}

# --- 배포 ---
Write-Host "`n[3/3] 배포"
npx wrangler pages deploy public --project-name $PROJECT --branch main --commit-dirty=true

Write-Host "`n완료. /admin 에 접속해 A형·B형 설문을 한 번씩 생성하세요." -ForegroundColor Green
