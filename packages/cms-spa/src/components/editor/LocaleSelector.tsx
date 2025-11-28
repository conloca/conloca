import * as Select from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

interface LocaleSelectorProps {
  currentLocale: string;
  availableLocales: string[];
  missingLocales?: string[];
  onChange: (locale: string) => void;
}

export function LocaleSelector({
  currentLocale,
  availableLocales,
  missingLocales = [],
  onChange,
}: LocaleSelectorProps) {
  return (
    <Select.Root value={currentLocale} onValueChange={onChange}>
      <Select.Trigger className="flex items-center gap-1 px-4 py-2 rounded-md text-sm text-grey-01 hover:bg-grey-10 transition-colors cursor-pointer">
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="h-4 w-4" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content className="bg-white border border-grey-09 rounded shadow-md" style={{ zIndex: 100 }}>
          <Select.Viewport className="p-1">
            {availableLocales.map((locale) => {
              const isCurrent = locale === currentLocale;
              const isMissing = missingLocales.includes(locale);

              return (
                <Select.Item
                  key={locale}
                  value={locale}
                  className={cn(
                    'px-3 py-2 rounded cursor-pointer outline-none transition-colors',
                    isCurrent && 'bg-azure-04 text-white',
                    !isCurrent && !isMissing && 'hover:bg-grey-11',
                    isMissing && 'text-grey-04',
                  )}
                  data-testid={`locale-option-${locale}`}
                >
                  <Select.ItemText>{locale}</Select.ItemText>
                </Select.Item>
              );
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
