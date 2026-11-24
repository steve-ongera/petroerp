$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$appFile = Join-Path $root "App.jsx"

if (-not (Test-Path $appFile)) {
  Write-Error "Could not find App.jsx at: $appFile"
  exit 1
}

$login = @'
import { useState } from 'react';
import { useAuth } from '../../context/AppContext';
import { errorMessage } from '../../services/api';

export default function Login() {
  const { login } = useAuth();
  const [f, setF] = useState({ username: '', password: '', otp: '' });
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(f.username.trim(), f.password, f.otp.trim() || undefined);
    } catch (err) {
      const msg = errorMessage(err);
      if (/otp|authenticator/i.test(msg)) setNeedOtp(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#0b1f3a' }}>
      <form onSubmit={submit} style={{ background: '#fff', padding: 32, borderRadius: 10, width: 340 }}>
        <h1 style={{ margin: '0 0 4px', color: '#0b1f3a' }}>PetroERP</h1>
        <p style={{ margin: '0 0 20px', color: '#4b5b6b' }}>Sign in to continue</p>
        <label>Username
          <input autoFocus autoComplete="username" value={f.username} onChange={set('username')} required style={{ width: '100%', margin: '4px 0 12px' }} />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={f.password} onChange={set('password')} required style={{ width: '100%', margin: '4px 0 12px' }} />
        </label>
        {needOtp && (
          <label>Authenticator code
            <input inputMode="numeric" autoComplete="one-time-code" value={f.otp} onChange={set('otp')} style={{ width: '100%', margin: '4px 0 12px' }} />
          </label>
        )}
        {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
        <button disabled={busy} style={{ width: '100%', background: '#0f7b4f', color: '#fff', border: 0, padding: 10, borderRadius: 6 }}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
'@

$content = Get-Content $appFile -Raw
# Matches lazy(() => import('./pages/group/Name')) with single or double quotes
$keys = [regex]::Matches($content, "import\(\s*['""]\./pages/([^'""]+?)['""]\s*\)") |
  ForEach-Object { $_.Groups[1].Value.Trim() } |
  Where-Object { $_ } |
  Sort-Object -Unique

$made = 0
foreach ($k in $keys) {
  $p = Join-Path $root ("pages/" + ($k -replace '/', '\') + ".jsx")
  if (Test-Path $p) { continue }

  $dir = Split-Path $p -Parent
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $leaf = ($k -split '/')[-1]
  if ($k -eq 'auth/Login') {
    Set-Content -Path $p -Value $login -Encoding utf8
    $made++
    continue
  }

  $label = $leaf -creplace '([a-z])([A-Z])', '$1 $2'
  $stub = @"
export default function $leaf() {
  return (
    <div style={{ padding: 24 }}>
      <h2>$label</h2>
      <p>Under development</p>
    </div>
  );
}
"@
  Set-Content -Path $p -Value $stub -Encoding utf8
  $made++
}

Write-Host "Created $made new page file(s) out of $($keys.Count) page(s) in App.jsx." -ForegroundColor Green