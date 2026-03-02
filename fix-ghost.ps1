$f = "c:\Users\mauri\Documents\Locus - MP\Locus -MP\client\lobby-ui.js"
$t = [System.IO.File]::ReadAllText($f)
$pattern = '(?s)(\t{4}let radiusStyle = \x27\x27;)\r?\n\t{4}if \(forGhost\) \{.*?radiusStyle = \x60border-radius: \$\{tl\} \$\{tr\} \$\{br\} \$\{bl\} !important;\x60;\r?\n\t{4}\}'
$replacement = "`t`t`t`tlet radiusStyle = '';`r`n`t`t`t`tif (forGhost) {`r`n`t`t`t`t`t// Uniform radius per cell - same as board cells`r`n`t`t`t`t`tradiusStyle = 'border-radius: var(--mp-cell-radius, 5px) !important;';`r`n`t`t`t`t}"
$new = [regex]::Replace($t, $pattern, $replacement)
if ($new -ne $t) {
    [System.IO.File]::WriteAllText($f, $new, [System.Text.Encoding]::UTF8)
    Write-Host "OK - replaced"
} else {
    Write-Host "NO MATCH"
}
