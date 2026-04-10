import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type TeamMember = {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatarUrl: string;
  linkedinUrl: string;
  githubUrl: string;
};

type TeamGridColumns = '2' | '3' | '4';

export type TeamGridProps = {
  label: string;
  title: string;
  subtitle: string;
  members: TeamMember[];
  columns: TeamGridColumns;
};

const gridColsClass: Record<TeamGridColumns, string> = {
  '2': 'grid sm:grid-cols-2 gap-6',
  '3': 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6',
  '4': 'grid sm:grid-cols-2 lg:grid-cols-4 gap-6',
};

function SocialLink({
  href,
  label,
  children,
  isEditing,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  isEditing: boolean;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors"
      onClick={isEditing ? (e) => e.preventDefault() : undefined}
    >
      {children}
    </a>
  );
}

export const TeamGrid: ComponentConfig<TeamGridProps> = {
  label: 'Team Grid',
  resolveFields: (data, { fields }) => {
    const count = data.props.members?.length || 0;
    const allOptions = [
      { label: '2 Columns', value: '2' },
      { label: '3 Columns', value: '3' },
      { label: '4 Columns', value: '4' },
    ];
    const filtered = count > 0 ? allOptions.filter((o) => Number(o.value) <= count) : allOptions;
    return {
      ...fields,
      columns: {
        ...fields.columns,
        visible: count > 1,
        options: filtered.length > 0 ? filtered : allOptions,
      },
    } as typeof fields;
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    members: {
      type: 'array',
      min: 1,
      max: 12,
      getItemSummary: (item) => (item.name && item.role ? `${item.name} — ${item.role}` : item.name || 'Member'),
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        name: 'Team Member',
        role: 'Role',
        bio: '',
        avatarUrl: '',
        linkedinUrl: '',
        githubUrl: '',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        name: { type: 'text' },
        role: { type: 'text' },
        bio: { type: 'textarea', label: 'Short Bio (optional)' },
        avatarUrl: { type: 'text', label: 'Avatar URL' },
        linkedinUrl: { type: 'text', label: 'LinkedIn URL (optional)' },
        githubUrl: { type: 'text', label: 'GitHub URL (optional)' },
      },
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
        { label: '4 Columns', value: '4' },
      ],
    },
  },
  defaultProps: {
    label: 'Team',
    title: 'Meet the team',
    subtitle: '',
    columns: '3',
    members: [
      {
        id: crypto.randomUUID(),
        name: 'Alice',
        role: 'Founder & CEO',
        bio: '',
        avatarUrl: '',
        linkedinUrl: '',
        githubUrl: '',
      },
      {
        id: crypto.randomUUID(),
        name: 'Bob',
        role: 'Lead Engineer',
        bio: '',
        avatarUrl: '',
        linkedinUrl: '',
        githubUrl: '',
      },
      {
        id: crypto.randomUUID(),
        name: 'Carol',
        role: 'Design Lead',
        bio: '',
        avatarUrl: '',
        linkedinUrl: '',
        githubUrl: '',
      },
    ],
  },
  render: ({ label, title, subtitle, members, columns, puck }) => {
    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} />

          {members.length === 0 ? (
            <EmptySlotPlaceholder label="Add team members using the sidebar panel" />
          ) : (
            <div className={gridColsClass[columns]}>
              {members.map((member, idx) => (
                <div
                  key={member.id}
                  className={cn(
                    'bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6 text-center',
                    { reveal: !puck.isEditing },
                  )}
                  style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                >
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt={member.name}
                      className="w-20 h-20 rounded-full object-cover mx-auto mb-4"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-4">
                      <span className="text-brand-600 dark:text-brand-400 font-bold text-xl">
                        {member.name.charAt(0)}
                      </span>
                    </div>
                  )}

                  <h3 className="text-surface-900 dark:text-white font-semibold text-sm">{member.name}</h3>
                  <p className="text-brand-600 dark:text-brand-400 text-xs font-medium mt-0.5">{member.role}</p>

                  {member.bio && (
                    <p className="text-surface-500 dark:text-surface-400 text-xs mt-3 leading-relaxed">{member.bio}</p>
                  )}

                  {(member.linkedinUrl || member.githubUrl) && (
                    <div className="flex items-center justify-center gap-3 mt-4">
                      <SocialLink
                        href={member.linkedinUrl}
                        label={`${member.name} on LinkedIn`}
                        isEditing={puck.isEditing}
                      >
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                      </SocialLink>
                      <SocialLink href={member.githubUrl} label={`${member.name} on GitHub`} isEditing={puck.isEditing}>
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                      </SocialLink>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
