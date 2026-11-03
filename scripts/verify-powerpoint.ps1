# Opens a PPTX in the installed Microsoft PowerPoint, reads its objects back, and renders each slide
# to PNG. This checks PowerPoint itself, which structural parsers cannot (plan §7).
# Usage: powershell -File scripts/verify-powerpoint.ps1 <file.pptx> <out-dir>
param(
  [Parameter(Mandatory)] [string] $Path,
  [Parameter(Mandatory)] [string] $OutDir
)
$ErrorActionPreference = 'Stop'
$full = (Resolve-Path $Path).Path
New-Item -ItemType Directory -Force $OutDir | Out-Null
$out = (Resolve-Path $OutDir).Path

# COM attaches to a running PowerPoint. Quitting that instance would close the user's own work.
$alreadyRunning = [bool](Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
$app = New-Object -ComObject PowerPoint.Application
try {
  # ReadOnly, Untitled = false, WithWindow = false. A file PowerPoint needs to repair raises an error here.
  $pres = $app.Presentations.Open($full, -1, 0, 0)
  try {
    $types = @{ 1 = 'AutoShape'; 3 = 'Chart'; 9 = 'Line'; 13 = 'Picture'; 14 = 'Placeholder'; 17 = 'TextBox'; 19 = 'Table'; 28 = 'Graphic' }
    "PowerPoint $($app.Version): opened with $($pres.Slides.Count) slides, $($pres.PageSetup.SlideWidth)x$($pres.PageSetup.SlideHeight)pt"
    foreach ($slide in $pres.Slides) {
      "--- slide $($slide.SlideIndex)"
      foreach ($s in $slide.Shapes) {
        $name = $types[[int]$s.Type]
        if (-not $name) { $name = "type$($s.Type)" }
        $text = ''
        if ($s.HasTextFrame -and $s.TextFrame.HasText) {
          $r = $s.TextFrame.TextRange
          $t = $r.Text -replace "[\r\n\v]", ' / '
          if ($t.Length -gt 50) { $t = $t.Substring(0, 50) }
          $text = "text='$t' font=$($r.Font.Name) size=$($r.Font.Size)"
        }
        '{0,-10} x={1,7:N1} y={2,7:N1} w={3,7:N1} h={4,7:N1} rot={5} {6}' -f $name, $s.Left, $s.Top, $s.Width, $s.Height, $s.Rotation, $text
      }
      if ($slide.HasNotesPage) {
        foreach ($s in $slide.NotesPage.Shapes) {
          if ($s.HasTextFrame -and $s.TextFrame.HasText -and $s.TextFrame.TextRange.Text.Length -gt 1) { "notes: $($s.TextFrame.TextRange.Text)" }
        }
      }
      $slide.Export((Join-Path $out ("slide{0}.png" -f $slide.SlideIndex)), 'PNG', 1280, 720)
    }
  } finally {
    $pres.Close()
  }
} finally {
  if (-not $alreadyRunning) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
