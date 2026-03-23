import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import {
  DEFAULT_OG_IMAGE_URL,
  DEFAULT_ROBOTS,
  SITE_DESCRIPTION,
  createOrganizationSchema,
  createWebPageSchema,
  createWebsiteSchema,
  resolveSiteUrl,
} from './seo'

type HeadTag = {
  tag: string
  attrs?: Record<string, string | boolean | undefined>
  content?: string
}

function getHeadTagIdentity(entry: HeadTag) {
  if (entry.tag === 'meta') {
    for (const key of ['name', 'property', 'http-equiv'] as const) {
      const value = entry.attrs?.[key]

      if (value) {
        return [key, value] as const
      }
    }
  }

  if (entry.tag === 'link' && (entry.attrs?.rel === 'canonical' || entry.attrs?.rel === 'sitemap')) {
    return ['rel', entry.attrs.rel] as const
  }
}

function hasHeadTag(head: HeadTag[], entry: HeadTag) {
  if (entry.tag === 'title') {
    return head.some((candidate) => candidate.tag === 'title')
  }

  const identity = getHeadTagIdentity(entry)

  if (!identity) {
    return false
  }

  const [key, value] = identity

  return head.some((candidate) => candidate.tag === entry.tag && candidate.attrs?.[key] === value)
}

function pushHeadTag(head: HeadTag[], entry: HeadTag) {
  if (hasHeadTag(head, entry)) {
    return
  }

  head.push(entry)
}

export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals
  const description = starlightRoute.entry.data.description ?? SITE_DESCRIPTION
  const title = starlightRoute.entry.data.title ?? starlightRoute.siteTitle
  const url = resolveSiteUrl(context.url.pathname)

  pushHeadTag(starlightRoute.head, { tag: 'meta', attrs: { property: 'og:image', content: DEFAULT_OG_IMAGE_URL } })
  pushHeadTag(starlightRoute.head, { tag: 'meta', attrs: { name: 'twitter:title', content: title } })
  pushHeadTag(starlightRoute.head, { tag: 'meta', attrs: { name: 'twitter:description', content: description } })
  pushHeadTag(starlightRoute.head, { tag: 'meta', attrs: { name: 'twitter:image', content: DEFAULT_OG_IMAGE_URL } })
  pushHeadTag(starlightRoute.head, { tag: 'meta', attrs: { name: 'robots', content: DEFAULT_ROBOTS } })

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      createOrganizationSchema(),
      createWebsiteSchema(),
      createWebPageSchema({
        title,
        description,
        url,
        type: 'TechArticle',
      }),
    ],
  }

  pushHeadTag(starlightRoute.head, {
    tag: 'script',
    attrs: { type: 'application/ld+json', 'data-conloca-seo': 'starlight' },
    content: JSON.stringify(structuredData),
  })
})
