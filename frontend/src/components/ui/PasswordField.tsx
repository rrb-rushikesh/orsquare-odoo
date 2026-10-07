import { useState } from 'react'
import { IconDice, IconEye, IconEyeOff } from '@/components/icons'
import { Input } from './Field'
import { IconButton } from './Button'
import { ICON } from './tokens'

/**
 * Password input with a show/hide toggle and a generate button. The generator is the caller's (the server makes the password, so
 * the rule for a good one lives in one place); this control only asks for it, fills the field and lets the caller copy it.
 */
export function PasswordField({
  value,
  onChange,
  onGenerate,
  generating,
  placeholder = 'Type a password or generate one',
  autoComplete = 'new-password',
}: {
  value: string
  onChange: (next: string) => void
  /** Called by the dice button; resolve with the new password. */
  onGenerate: () => Promise<string>
  generating?: boolean
  placeholder?: string
  autoComplete?: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex items-stretch">
      <Input
        fluid={false}
        className="min-w-0 flex-1 font-mono"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
      />
      <IconButton label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((v) => !v)}>
        {shown ? <IconEyeOff size={ICON.lg} /> : <IconEye size={ICON.lg} />}
      </IconButton>
      <IconButton
        label="Generate a secure password and copy it"
        loading={generating}
        onClick={async () => {
          const next = await onGenerate()
          onChange(next)
          setShown(true)
        }}
      >
        <IconDice size={ICON.lg} />
      </IconButton>
    </div>
  )
}
