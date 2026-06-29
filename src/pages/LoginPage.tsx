import { useState } from 'react'
import logo from '../assets/logo.svg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const PATENT_SAMPLES = [
  'US 10,234,567 B2',
  'US 9,887,221 A1',
  'EP 3 456 789 B1',
  'WO 2021/045123 A1',
  'US 11,002,344 B2',
  'JP 2020-123456 A',
  'US 8,765,432 B1',
  'EP 2 998 877 A1',
]

interface PatentLabel {
  text: string
  left: number
  top: number
  fontSize: number
  rotate: number
}

function makePatentField(count = 36): PatentLabel[] {
  return Array.from({ length: count }, (_, i) => ({
    text: PATENT_SAMPLES[i % PATENT_SAMPLES.length],
    left: Math.random() * 95,
    top: Math.random() * 95,
    fontSize: 11 + Math.random() * 4,
    rotate: Math.random() * 6 - 3,
  }))
}

function messageForError(err: { code?: string; message?: string } | null): string {
  switch (err?.code) {
    case 'NotAuthorizedException':
      return 'Incorrect email or password.'
    case 'UserNotFoundException':
      return 'No account found for that email.'
    case 'UserNotConfirmedException':
      return 'Account not confirmed yet. Contact an admin.'
    default:
      return err?.message || 'Sign-in failed. Please try again.'
  }
}

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [patentField] = useState<PatentLabel[]>(() => makePatentField())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onLogin(email, password)
    } catch (err) {
      setSubmitting(false)
      setError(messageForError(err as { code?: string; message?: string }))
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden">
      {/* Scattered patent numbers in the background */}
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
        {patentField.map((p, i) => (
          <span
            key={i}
            className="absolute text-muted-foreground/20 font-mono whitespace-nowrap"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              fontSize: `${p.fontSize}px`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          >
            {p.text}
          </span>
        ))}
      </div>

      <Card className="relative z-10 w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <img src={logo} alt="IP Atlas" className="h-7 w-7" />
            <span className="text-lg font-semibold tracking-tight">IP Atlas</span>
          </div>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Intellectual Property Landscape Analytics</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@otsuka.jp"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Otsuka Holdings · Internal use only
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
