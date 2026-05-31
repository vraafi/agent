Get-Process python -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
    [PSCustomObject]@{
        Id = $_.Id
        CommandLine = $cmd
    }
} | Format-Table -AutoSize
