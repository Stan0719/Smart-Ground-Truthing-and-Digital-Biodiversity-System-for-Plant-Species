param([ValidateSet('Check','Account','Face')][string]$Mode='Check')
$ErrorActionPreference='Stop'
$faceRoot=Join-Path $PSScriptRoot '..\face_backend'
$faceRoot=[System.IO.Path]::GetFullPath($faceRoot)
$pythonRuntime=Join-Path $faceRoot '.runtime\python311\python.exe'
if (-not (Test-Path -LiteralPath $pythonRuntime)) { throw 'Restore the workspace Python 3.11 runtime first. See docs/face-service-windows.md.' }
$keyPath=Join-Path $faceRoot 'data\account-service.key'
if ($Mode -eq 'Check') {
 & $pythonRuntime -B (Join-Path $faceRoot 'server.py') --check-models
 exit $LASTEXITCODE
}
$listenPort=if ($Mode -eq 'Account') { 3002 } else { 8000 }
$probe=New-Object System.Net.Sockets.TcpClient
try {
 try { $probe.Connect('127.0.0.1',$listenPort); $portBusy=$true } catch { $portBusy=$false }
} finally { $probe.Dispose() }
if ($portBusy) { throw "Port $listenPort is already in use; leave the existing service running." }
if (-not (Test-Path -LiteralPath $keyPath)) {
 if ($Mode -ne 'Account') { throw 'Start the private Account service first.' }
 [System.IO.Directory]::CreateDirectory((Split-Path $keyPath)) | Out-Null
 $keyBytes=New-Object byte[] 32
 $generator=[System.Security.Cryptography.RandomNumberGenerator]::Create()
 try { $generator.GetBytes($keyBytes); [System.IO.File]::WriteAllBytes($keyPath,$keyBytes) } finally { $generator.Dispose(); [Array]::Clear($keyBytes,0,$keyBytes.Length) }
 $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=New-Object System.Security.AccessControl.FileSecurity
 $acl.SetAccessRuleProtection($true,$false)
 $acl.SetOwner($sid)
 $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
 Set-Acl -LiteralPath $keyPath -AclObject $acl
}
$env:FACE_ACCOUNT_SERVICE_KEY_FILE=$keyPath
$env:FACE_ACCOUNT_SERVICE_URL='http://127.0.0.1:3002'
if ($Mode -eq 'Account') {
 $env:HOST='127.0.0.1';$env:PORT='3002'
 & node (Join-Path $PSScriptRoot '..\..\web\server\index.mjs')
} else {
 & $pythonRuntime -B -u (Join-Path $faceRoot 'run_backend.py') --host 127.0.0.1 --port 8000
}
exit $LASTEXITCODE
