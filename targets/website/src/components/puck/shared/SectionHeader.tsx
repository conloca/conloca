type SectionHeaderProps = {
  label?: string;
  title?: string;
  subtitle?: string;
  align?: 'center' | 'left';
  headingLevel?: 'h1' | 'h2';
};

export function SectionHeader({ label, title, subtitle, align = 'center', headingLevel = 'h2' }: SectionHeaderProps) {
  if (!label && !title && !subtitle) return null;

  const Heading = headingLevel;

  return (
    <div className={align === 'center' ? 'text-center mb-16' : 'mb-16'}>
      {label && (
        <p className="text-brand-600 dark:text-brand-400 text-sm font-medium tracking-wide uppercase mb-3">{label}</p>
      )}
      {title && (
        <Heading className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white mb-4">{title}</Heading>
      )}
      {subtitle && (
        <p className={`text-surface-500 dark:text-surface-400 max-w-xl ${align === 'center' ? 'mx-auto' : ''}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
