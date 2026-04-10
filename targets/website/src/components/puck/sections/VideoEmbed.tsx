import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type VideoAspectRatio = '16/9' | '4/3' | '1/1';

export type VideoEmbedProps = {
  title: string;
  caption: string;
  url: string;
  aspectRatio: VideoAspectRatio;
  width: 'narrow' | 'default' | 'wide';
};

const widthClasses: Record<string, string> = {
  narrow: 'max-w-2xl',
  default: 'max-w-4xl',
  wide: 'max-w-6xl',
};

const aspectClasses: Record<VideoAspectRatio, string> = {
  '16/9': 'aspect-video',
  '4/3': 'aspect-[4/3]',
  '1/1': 'aspect-square',
};

function extractEmbedUrl(url: string): string | null {
  if (!url) return null;

  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`;

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  // Already an embed URL or other iframe-compatible URL
  if (url.includes('/embed/') || url.includes('player.')) return url;

  return null;
}

export const VideoEmbed: ComponentConfig<VideoEmbedProps> = {
  label: 'Video Embed',
  fields: {
    title: { type: 'text', label: 'Section Title (optional)', contentEditable: true },
    url: {
      type: 'text',
      label: 'Video URL (YouTube or Vimeo)',
    },
    caption: { type: 'text', label: 'Caption (optional)', contentEditable: true },
    aspectRatio: {
      type: 'radio',
      label: 'Aspect Ratio',
      options: [
        { label: '16:9 (widescreen)', value: '16/9' },
        { label: '4:3 (standard)', value: '4/3' },
        { label: '1:1 (square)', value: '1/1' },
      ],
    },
    width: {
      type: 'select',
      label: 'Width',
      options: [
        { label: 'Narrow', value: 'narrow' },
        { label: 'Default', value: 'default' },
        { label: 'Wide', value: 'wide' },
      ],
    },
  },
  defaultProps: {
    title: '',
    url: '',
    caption: '',
    aspectRatio: '16/9',
    width: 'default',
  },
  render: ({ title, url, caption, aspectRatio, width, puck }) => {
    const embedUrl = extractEmbedUrl(url);

    return (
      <section className="py-12 sm:py-16">
        <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', widthClasses[width])}>
          {title && (
            <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-6 text-center">
              {title}
            </h2>
          )}

          <div
            className={cn(
              'rounded-xl overflow-hidden border border-surface-200 dark:border-surface-800',
              aspectClasses[aspectRatio],
            )}
          >
            {embedUrl ? (
              <iframe
                src={embedUrl}
                title={title || 'Video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full bg-surface-100 dark:bg-surface-900 flex items-center justify-center">
                <div className="text-center p-6">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-surface-300 dark:text-surface-700 mx-auto mb-3"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <p className="text-sm text-surface-500 dark:text-surface-400">
                    {puck.isEditing ? 'Paste a YouTube or Vimeo URL in the sidebar' : 'No video URL provided'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {caption && <p className="text-center text-xs text-surface-500 dark:text-surface-400 mt-3">{caption}</p>}
        </div>
      </section>
    );
  },
};
