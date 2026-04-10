import type { Config } from '@puckeditor/core';
import type {
  BadgeProps,
  ButtonProps,
  DividerProps,
  FlexProps,
  GridProps,
  HeadingProps,
  ImageProps,
  SpaceProps,
  TextProps,
} from './components/puck/primitives';
import { Badge, Button, Divider, Flex, Grid, Heading, Image, Space, Text } from './components/puck/primitives';
import type {
  ArticleHeroProps,
  BlockquoteProps,
  BlogPostTemplateProps,
  CalloutProps,
  CodeBlockProps,
  ComparisonTableProps,
  ContactSectionProps,
  ContentBlockSectionProps,
  ContentPageHeroProps,
  ContentPageTemplateProps,
  CTABannerProps,
  FAQProps,
  FeatureCardsProps,
  FeatureListProps,
  HeroProps,
  HostedComparisonProps,
  LogoCloudProps,
  NumberedFlowProps,
  PostGridProps,
  PricingTableProps,
  ProseSectionProps,
  StatsProps,
  StepsProps,
  TeamGridProps,
  TestimonialsProps,
  VideoEmbedProps,
} from './components/puck/sections';
import {
  ArticleHero,
  Blockquote,
  BlogPostTemplate,
  Callout,
  CodeBlock,
  ComparisonTable,
  ContactSection,
  ContentBlockSection,
  ContentPageHero,
  ContentPageTemplate,
  CTABanner,
  FAQ,
  FeatureCards,
  FeatureList,
  Hero,
  HostedComparison,
  LogoCloud,
  NumberedFlow,
  PostGrid,
  PricingTable,
  ProseSection,
  Stats,
  Steps,
  TeamGrid,
  Testimonials,
  VideoEmbed,
} from './components/puck/sections';

type Components = {
  ArticleHero: ArticleHeroProps;
  Badge: BadgeProps;
  Blockquote: BlockquoteProps;
  BlogPostTemplate: BlogPostTemplateProps;
  Button: ButtonProps;
  Callout: CalloutProps;
  CodeBlock: CodeBlockProps;
  ComparisonTable: ComparisonTableProps;
  ContactSection: ContactSectionProps;
  ContentBlockSection: ContentBlockSectionProps;
  ContentPageHero: ContentPageHeroProps;
  ContentPageTemplate: ContentPageTemplateProps;
  CTABanner: CTABannerProps;
  Divider: DividerProps;
  FAQ: FAQProps;
  FeatureCards: FeatureCardsProps;
  FeatureList: FeatureListProps;
  Flex: FlexProps;
  Grid: GridProps;
  Heading: HeadingProps;
  Hero: HeroProps;
  HostedComparison: HostedComparisonProps;
  Image: ImageProps;
  LogoCloud: LogoCloudProps;
  NumberedFlow: NumberedFlowProps;
  PostGrid: PostGridProps;
  PricingTable: PricingTableProps;
  ProseSection: ProseSectionProps;
  Space: SpaceProps;
  Stats: StatsProps;
  Steps: StepsProps;
  TeamGrid: TeamGridProps;
  Testimonials: TestimonialsProps;
  Text: TextProps;
  VideoEmbed: VideoEmbedProps;
};

const puckConfig: Config<Components> = {
  categories: {
    templates: {
      title: 'Templates',
      defaultExpanded: true,
      components: ['ContentPageTemplate', 'BlogPostTemplate'],
    },
    heroAndCta: {
      title: 'Hero & CTA',
      components: ['Hero', 'ContentPageHero', 'ArticleHero', 'CTABanner'],
    },
    content: {
      title: 'Content',
      components: [
        'ProseSection',
        'CodeBlock',
        'ContentBlockSection',
        'Callout',
        'Blockquote',
        'VideoEmbed',
        'ContactSection',
      ],
    },
    socialProof: {
      title: 'Social Proof',
      components: ['Testimonials', 'LogoCloud', 'Stats', 'TeamGrid'],
    },
    features: {
      title: 'Features',
      components: ['FeatureCards', 'FeatureList', 'FAQ', 'Steps', 'NumberedFlow', 'PricingTable', 'PostGrid'],
    },
    comparison: {
      title: 'Comparison',
      components: ['ComparisonTable', 'HostedComparison'],
    },
    primitives: {
      title: 'Primitives',
      components: ['Heading', 'Text', 'Image', 'Button', 'Badge'],
    },
    layout: {
      title: 'Layout',
      components: ['Grid', 'Flex', 'Space', 'Divider'],
    },
  },
  components: {
    ArticleHero,
    Badge,
    Blockquote,
    BlogPostTemplate,
    Button,
    Callout,
    CodeBlock,
    ComparisonTable,
    ContactSection,
    ContentBlockSection: { ...ContentBlockSection, label: 'Content Section' },
    ContentPageHero,
    ContentPageTemplate,
    CTABanner,
    Divider,
    FAQ,
    FeatureCards,
    FeatureList,
    Flex: { ...Flex, label: 'Flex Container' },
    Grid: { ...Grid, label: 'Grid Container' },
    Heading,
    Hero,
    HostedComparison: { ...HostedComparison, label: 'Plan Comparison' },
    Image,
    LogoCloud,
    NumberedFlow: { ...NumberedFlow, label: 'Numbered Steps' },
    PostGrid,
    PricingTable,
    ProseSection,
    Space: { ...Space, label: 'Spacer' },
    Stats: { ...Stats, label: 'Statistics' },
    Steps,
    TeamGrid,
    Testimonials,
    Text,
    VideoEmbed,
  },
};

export default puckConfig;
