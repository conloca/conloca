import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type PostCard = {
  id: string;
  title: string;
  excerpt: string;
  imageUrl: string;
  href: string;
  author: string;
  date: string;
  tag: string;
};

type PostGridColumns = '2' | '3';

export type PostGridProps = {
  label: string;
  title: string;
  subtitle: string;
  posts: PostCard[];
  columns: PostGridColumns;
  showImages: 'true' | 'false';
};

const gridColsClass: Record<PostGridColumns, string> = {
  '2': 'grid sm:grid-cols-2 gap-6',
  '3': 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6',
};

export const PostGrid: ComponentConfig<PostGridProps> = {
  label: 'Post Grid',
  resolveFields: (data, { fields }) => {
    const count = data.props.posts?.length || 0;
    return {
      ...fields,
      columns: { ...fields.columns, visible: count > 1 },
    };
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    posts: {
      type: 'array',
      min: 1,
      max: 12,
      getItemSummary: (item) => item.title || 'Post',
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        title: 'Post Title',
        excerpt: 'A brief description of this blog post.',
        imageUrl: '',
        href: '#',
        author: '',
        date: '',
        tag: '',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        title: { type: 'text' },
        excerpt: { type: 'textarea' },
        imageUrl: { type: 'text', label: 'Cover Image URL (optional)' },
        href: { type: 'text', label: 'Post URL' },
        author: { type: 'text', label: 'Author (optional)' },
        date: { type: 'text', label: 'Date (optional)' },
        tag: { type: 'text', label: 'Tag (optional)' },
      },
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
      ],
    },
    showImages: {
      type: 'radio',
      label: 'Show Cover Images',
      options: [
        { label: 'Yes', value: 'true' },
        { label: 'No', value: 'false' },
      ],
    },
  },
  defaultProps: {
    label: 'Blog',
    title: 'Latest Posts',
    subtitle: '',
    columns: '3',
    showImages: 'true',
    posts: [
      {
        id: crypto.randomUUID(),
        title: 'Getting Started with Conloca',
        excerpt: 'Learn how to set up a file-based CMS in your Astro project in under 10 minutes.',
        imageUrl: '',
        href: '#',
        author: '',
        date: '',
        tag: 'Tutorial',
      },
      {
        id: crypto.randomUUID(),
        title: 'Why File-Based CMS?',
        excerpt: 'The case for keeping your content in git instead of a database.',
        imageUrl: '',
        href: '#',
        author: '',
        date: '',
        tag: 'Opinion',
      },
      {
        id: crypto.randomUUID(),
        title: 'Building Custom Puck Components',
        excerpt: 'A guide to creating reusable visual components for your page editor.',
        imageUrl: '',
        href: '#',
        author: '',
        date: '',
        tag: 'Guide',
      },
    ],
  },
  render: ({ label, title, subtitle, posts, columns, showImages, puck }) => {
    const withImages = showImages === 'true';

    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} />

          {posts.length === 0 ? (
            <EmptySlotPlaceholder label="Add posts using the sidebar panel" />
          ) : (
            <div className={gridColsClass[columns]}>
              {posts.map((post, idx) => (
                <a
                  key={post.id}
                  href={post.href}
                  className={cn(
                    'group bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl overflow-hidden hover:border-brand-500/30 hover:bg-surface-100 dark:hover:bg-surface-900/70 transition-all duration-300 flex flex-col',
                    { reveal: !puck.isEditing },
                  )}
                  style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                  onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
                >
                  {withImages && post.imageUrl && (
                    <div className="aspect-video overflow-hidden">
                      <img
                        src={post.imageUrl}
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  )}

                  <div className="p-5 flex flex-col flex-1">
                    {post.tag && (
                      <span className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wide mb-2">
                        {post.tag}
                      </span>
                    )}

                    <h3 className="text-surface-900 dark:text-white font-semibold text-sm mb-2 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                      {post.title}
                    </h3>

                    <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed flex-1">
                      {post.excerpt}
                    </p>

                    {(post.author || post.date) && (
                      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-surface-200/50 dark:border-surface-800/50 text-xs text-surface-500 dark:text-surface-400">
                        {post.author && <span>{post.author}</span>}
                        {post.author && post.date && (
                          <span className="text-surface-300 dark:text-surface-700">&middot;</span>
                        )}
                        {post.date && <time>{post.date}</time>}
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
