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
  BlockquoteProps,
  CalloutProps,
  CodeBlockProps,
  ComparisonTableProps,
  ContentBlockSectionProps,
  ContentPageHeroProps,
  ContentPageTemplateProps,
  CTABannerProps,
  FAQProps,
  FeatureCardsProps,
  FeatureListProps,
  HeroProps,
  HostedComparisonProps,
  NumberedFlowProps,
  ProseSectionProps,
  RichTextSectionProps,
  StepsProps,
} from './components/puck/sections';
import {
  Blockquote,
  Callout,
  CodeBlock,
  ComparisonTable,
  ContentBlockSection,
  ContentPageHero,
  ContentPageTemplate,
  CTABanner,
  FAQ,
  FeatureCards,
  FeatureList,
  Hero,
  HostedComparison,
  NumberedFlow,
  ProseSection,
  RichTextSection,
  Steps,
} from './components/puck/sections';

type Components = {
  Badge: BadgeProps;
  Blockquote: BlockquoteProps;
  Button: ButtonProps;
  Callout: CalloutProps;
  ContentBlockSection: ContentBlockSectionProps;
  ContentPageHero: ContentPageHeroProps;
  ContentPageTemplate: ContentPageTemplateProps;
  CTABanner: CTABannerProps;
  CodeBlock: CodeBlockProps;
  ComparisonTable: ComparisonTableProps;
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
  NumberedFlow: NumberedFlowProps;
  ProseSection: ProseSectionProps;
  RichTextSection: RichTextSectionProps;
  Space: SpaceProps;
  Steps: StepsProps;
  Text: TextProps;
};

const puckConfig: Config<Components> = {
  categories: {
    heroAndCta: {
      title: 'Hero & CTA',
      defaultExpanded: true,
      components: ['Hero', 'CTABanner'],
    },
    contentPages: {
      title: 'Content Pages',
      components: ['ContentPageTemplate', 'ContentPageHero', 'Callout', 'Blockquote'],
    },
    content: {
      title: 'Content',
      components: ['ContentBlockSection', 'CodeBlock', 'FAQ', 'RichTextSection', 'ProseSection', 'FeatureList'],
    },
    showcase: {
      title: 'Showcase',
      components: ['FeatureCards', 'Steps', 'NumberedFlow', 'ComparisonTable', 'HostedComparison'],
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
    Badge,
    Blockquote,
    Button,
    Callout,
    ContentBlockSection: { ...ContentBlockSection, label: 'Content Section' },
    ContentPageHero,
    ContentPageTemplate,
    CTABanner,
    CodeBlock,
    ComparisonTable,
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
    NumberedFlow: { ...NumberedFlow, label: 'Numbered Steps' },
    ProseSection,
    RichTextSection: { ...RichTextSection, label: 'Rich Text (Legacy)' },
    Space: { ...Space, label: 'Spacer' },
    Steps,
    Text,
  },
};

export default puckConfig;
