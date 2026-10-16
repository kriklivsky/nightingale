import type { ComponentProps } from 'react';

export function Button({
  className = '',
  variant = 'default',
  submit = false,
  ...props
}: Omit<ComponentProps<'button'>, 'type'> & { variant?: 'default' | 'outline'; submit?: boolean }) {
  const appearance =
    variant === 'outline'
      ? 'border-border bg-background text-foreground'
      : 'border-primary bg-primary text-primary-foreground';
  return (
    <button
      type={submit ? 'submit' : 'button'}
      className={`rounded-lg border font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring disabled:opacity-50 ${appearance} ${className}`}
      {...props}
    />
  );
}
