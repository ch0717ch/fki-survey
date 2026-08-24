# ============================================================
# 파비콘 PNG + 링크 공유용 OG 썸네일 생성
#
#   .\tools\make-assets.ps1
#
# 카카오톡·슬랙 등은 SVG 썸네일을 렌더하지 않으므로 PNG로 굽는다.
# ============================================================

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDirs = @(
  (Join-Path $PSScriptRoot '..\cloud\public'),
  (Join-Path $PSScriptRoot '..\public')
) | ForEach-Object { (Resolve-Path $_).Path }

$INK1 = [Drawing.Color]::FromArgb(255, 7, 7, 9)
$INK2 = [Drawing.Color]::FromArgb(255, 17, 17, 20)
$GOLD = [Drawing.Color]::FromArgb(255, 201, 162, 39)
$GOLD_HI = [Drawing.Color]::FromArgb(255, 240, 218, 150)
$PAPER = [Drawing.Color]::FromArgb(255, 246, 244, 240)

function Pick-Font {
  param([string[]]$Candidates)
  $installed = (New-Object Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
  foreach ($c in $Candidates) { if ($installed -contains $c) { return $c } }
  return 'Malgun Gothic'
}

$SERIF = Pick-Font @('Noto Serif KR', 'Nanum Myeongjo', 'Batang', '바탕', 'Gulim')
$SANS = Pick-Font @('Malgun Gothic', 'Noto Sans KR', 'Segoe UI')
Write-Host "폰트 — 세리프: $SERIF / 산세리프: $SANS"

function New-Canvas {
  param([int]$W, [int]$H)
  $bmp = New-Object Drawing.Bitmap($W, $H)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  # ClearType은 RGB 서브픽셀 배열을 가정하므로 PNG로 구우면 색 번짐이 남는다.
  $g.TextRenderingHint = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  return @($bmp, $g)
}

# 배경: 거의 검정에 가까운 수직 그라데이션 + 상단 중앙의 아주 옅은 골드 글로우
function Draw-Ground {
  param($g, [int]$W, [int]$H)
  $rect = New-Object Drawing.Rectangle(0, 0, $W, $H)
  $lg = New-Object Drawing.Drawing2D.LinearGradientBrush($rect, $INK2, $INK1, 90.0)
  $g.FillRectangle($lg, $rect)
  $lg.Dispose()

  # 반투명 원을 겹치면 동심원 밴딩이 남는다. PathGradientBrush로 매끄럽게 떨어뜨린다.
  $rw = $W * 1.35
  $rh = $H * 1.15
  $path = New-Object Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse([float]($W / 2 - $rw / 2), [float](-$rh * 0.62), [float]$rw, [float]$rh)

  $pgb = New-Object Drawing.Drawing2D.PathGradientBrush($path)
  $pgb.CenterPoint = New-Object Drawing.PointF([float]($W / 2), [float](-$rh * 0.62 + $rh / 2))
  $pgb.CenterColor = [Drawing.Color]::FromArgb(30, 201, 162, 39)
  $pgb.SurroundColors = @([Drawing.Color]::FromArgb(0, 201, 162, 39))
  $pgb.FocusScales = New-Object Drawing.PointF(0.06, 0.06)
  $g.FillPath($pgb, $path)

  $pgb.Dispose(); $path.Dispose()
}

# 45도 회전한 정사각형(다이아몬드)
function Draw-Diamond {
  param($g, [double]$cx, [double]$cy, [double]$half, $brushOrPen, [bool]$Fill, [double]$width = 1)
  $pts = @(
    (New-Object Drawing.PointF([float]$cx, [float]($cy - $half))),
    (New-Object Drawing.PointF([float]($cx + $half), [float]$cy)),
    (New-Object Drawing.PointF([float]$cx, [float]($cy + $half))),
    (New-Object Drawing.PointF([float]($cx - $half), [float]$cy))
  )
  if ($Fill) { $g.FillPolygon($brushOrPen, $pts) } else { $g.DrawPolygon($brushOrPen, $pts) }
}

# 자간을 준 글자 그리기 (GDI+는 letter-spacing이 없어 한 글자씩 찍는다)
function Draw-Tracked {
  param($g, [string]$Text, $Font, $Brush, [double]$CenterX, [double]$Y, [double]$Track)
  $widths = @()
  foreach ($ch in $Text.ToCharArray()) {
    $widths += $g.MeasureString([string]$ch, $Font, [Drawing.PointF]::new(0, 0),
      [Drawing.StringFormat]::GenericTypographic).Width
  }
  $total = ($widths | Measure-Object -Sum).Sum + ($Track * ($Text.Length - 1))
  $x = $CenterX - $total / 2
  for ($i = 0; $i -lt $Text.Length; $i++) {
    $g.DrawString([string]$Text[$i], $Font, $Brush, [float]$x, [float]$Y,
      [Drawing.StringFormat]::GenericTypographic)
    $x += $widths[$i] + $Track
  }
}

function Draw-Centered {
  param($g, [string]$Text, $Font, $Brush, [double]$CenterX, [double]$Y)
  $sf = New-Object Drawing.StringFormat
  $sf.Alignment = 'Center'
  $g.DrawString($Text, $Font, $Brush, [float]$CenterX, [float]$Y, $sf)
  $sf.Dispose()
}

# ------------------------------------------------------------
# 1. 아이콘 (파비콘 PNG / 애플 터치 아이콘)
# ------------------------------------------------------------
function Make-Icon {
  param([int]$Size, [string]$Path)
  $c = New-Canvas $Size $Size
  $bmp = $c[0]; $g = $c[1]

  $rect = New-Object Drawing.Rectangle(0, 0, $Size, $Size)
  $lg = New-Object Drawing.Drawing2D.LinearGradientBrush($rect,
    [Drawing.Color]::FromArgb(255, 23, 23, 27), [Drawing.Color]::FromArgb(255, 8, 8, 10), 90.0)
  $g.FillRectangle($lg, $rect)
  $lg.Dispose()

  $s = $Size / 64.0
  $cx = $Size / 2.0

  # 테두리
  $pen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(108, 201, 162, 39), [float](1.6 * $s))
  $g.DrawRectangle($pen, [float](1.2 * $s), [float](1.2 * $s),
    [float]($Size - 2.4 * $s), [float]($Size - 2.4 * $s))
  $pen.Dispose()

  # 바깥 다이아몬드 (선)
  $pen2 = New-Object Drawing.Pen([Drawing.Color]::FromArgb(150, 201, 162, 39), [float](2.1 * $s))
  Draw-Diamond $g $cx $cx (20.5 * $s) $pen2 $false
  $pen2.Dispose()

  # 안쪽 다이아몬드 (채움, 골드 그라데이션)
  $gr = New-Object Drawing.Rectangle(0, 0, $Size, $Size)
  $gb = New-Object Drawing.Drawing2D.LinearGradientBrush($gr, $GOLD_HI,
    [Drawing.Color]::FromArgb(255, 138, 109, 20), 45.0)
  Draw-Diamond $g $cx $cx (10.6 * $s) $gb $true
  $gb.Dispose()

  $bmp.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  $([IO.Path]::GetFileName($Path)) ($Size x $Size)"
}

# ------------------------------------------------------------
# 2. OG 썸네일 (카카오톡 / 슬랙 / 트위터)
# ------------------------------------------------------------
function Make-OG {
  param([string]$Path)
  $W = 1200; $H = 630
  $c = New-Canvas $W $H
  $bmp = $c[0]; $g = $c[1]

  Draw-Ground $g $W $H

  # 이중 골드 프레임
  $p1 = New-Object Drawing.Pen([Drawing.Color]::FromArgb(120, 201, 162, 39), 1.6)
  $g.DrawRectangle($p1, 30, 30, $W - 60, $H - 60); $p1.Dispose()
  $p2 = New-Object Drawing.Pen([Drawing.Color]::FromArgb(48, 201, 162, 39), 1.0)
  $g.DrawRectangle($p2, 40, 40, $W - 80, $H - 80); $p2.Dispose()

  $cx = $W / 2.0
  $goldBrush = New-Object Drawing.SolidBrush($GOLD)
  $goldHiBrush = New-Object Drawing.SolidBrush($GOLD_HI)
  $paperBrush = New-Object Drawing.SolidBrush($PAPER)
  $mutedBrush = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 158, 154, 148))

  # crest: 하인라인 — 다이아몬드 — 하인라인
  $y = 150.0
  $pen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(110, 201, 162, 39), 1.2)
  $g.DrawLine($pen, [float]($cx - 108), [float]$y, [float]($cx - 30), [float]$y)
  $g.DrawLine($pen, [float]($cx + 30), [float]$y, [float]($cx + 108), [float]$y)
  $pen.Dispose()
  Draw-Diamond $g $cx $y 7.5 $goldBrush $true

  # 아이브로우
  $fEyebrow = New-Object Drawing.Font($SANS, 15, [Drawing.FontStyle]::Regular)
  Draw-Tracked $g 'FKI  HUMAN RESOURCE DEVELOPMENT' $fEyebrow $goldBrush $cx 188 4.2
  $fEyebrow.Dispose()

  # 메인 타이틀
  $fTitle = New-Object Drawing.Font($SERIF, 64, [Drawing.FontStyle]::Bold)
  Draw-Centered $g '교육과정 만족도조사' $fTitle $paperBrush $cx 248
  $fTitle.Dispose()

  # 골드 구분선
  $rectLine = New-Object Drawing.Rectangle([int]($cx - 150), 386, 300, 2)
  $lgLine = New-Object Drawing.Drawing2D.LinearGradientBrush($rectLine,
    [Drawing.Color]::FromArgb(0, 201, 162, 39), [Drawing.Color]::FromArgb(230, 240, 218, 150), 0.0)
  $g.FillRectangle($lgLine, $rectLine); $lgLine.Dispose()

  # 기관명
  $fOrg = New-Object Drawing.Font($SERIF, 33, [Drawing.FontStyle]::Regular)
  Draw-Centered $g '한경협국제경영원' $fOrg $goldHiBrush $cx 418
  $fOrg.Dispose()

  $fDept = New-Object Drawing.Font($SANS, 17, [Drawing.FontStyle]::Regular)
  Draw-Tracked $g '인재교육사업실' $fDept $mutedBrush $cx 476 6.0
  $fDept.Dispose()

  # 하단 안내
  $fFoot = New-Object Drawing.Font($SANS, 15, [Drawing.FontStyle]::Regular)
  Draw-Centered $g '소요 시간 약 2분  ·  응답은 통계 목적으로만 활용됩니다' $fFoot $mutedBrush $cx 543
  $fFoot.Dispose()

  $goldBrush.Dispose(); $goldHiBrush.Dispose(); $paperBrush.Dispose(); $mutedBrush.Dispose()

  $bmp.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  $([IO.Path]::GetFileName($Path)) ($W x $H)"
}

foreach ($dir in $outDirs) {
  Write-Host "`n[$dir]"
  Make-Icon 32 (Join-Path $dir 'favicon-32.png')
  Make-Icon 180 (Join-Path $dir 'apple-touch-icon.png')
  Make-OG (Join-Path $dir 'og-image.png')
}

Write-Host "`n완료."
