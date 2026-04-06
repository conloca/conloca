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
  CodeBlockProps,
  ComparisonTableProps,
  ContentBlockSectionProps,
  CTABannerProps,
  FAQProps,
  FeatureCardsProps,
  HeroProps,
  HostedComparisonProps,
  NumberedFlowProps,
  RichTextSectionProps,
  StepsProps,
} from './components/puck/sections';
import {
  CodeBlock,
  ComparisonTable,
  ContentBlockSection,
  CTABanner,
  FAQ,
  FeatureCards,
  Hero,
  HostedComparison,
  NumberedFlow,
  RichTextSection,
  Steps,
} from './components/puck/sections';

type Components = {
  Badge: BadgeProps;
  Button: ButtonProps;
  ContentBlockSection: ContentBlockSectionProps;
  CTABanner: CTABannerProps;
  CodeBlock: CodeBlockProps;
  ComparisonTable: ComparisonTableProps;
  Divider: DividerProps;
  FAQ: FAQProps;
  FeatureCards: FeatureCardsProps;
  Flex: FlexProps;
  Grid: GridProps;
  Heading: HeadingProps;
  Hero: HeroProps;
  HostedComparison: HostedComparisonProps;
  Image: ImageProps;
  NumberedFlow: NumberedFlowProps;
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
    content: {
      title: 'Content',
      components: ['ContentBlockSection', 'CodeBlock', 'FAQ'],
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
    Button,
    ContentBlockSection: { ...ContentBlockSection, label: 'Content Section' },
    CTABanner,
    CodeBlock,
    ComparisonTable,
    Divider,
    FAQ,
    FeatureCards,
    Flex: { ...Flex, label: 'Flex Container' },
    Grid: { ...Grid, label: 'Grid Container' },
    Heading,
    Hero,
    HostedComparison: { ...HostedComparison, label: 'Plan Comparison' },
    Image,
    NumberedFlow: { ...NumberedFlow, label: 'Numbered Steps' },
    RichTextSection: { ...RichTextSection, label: 'Rich Text (Legacy)' },
    Space: { ...Space, label: 'Spacer' },
    Steps,
    Text,
  },
};

export default puckConfig;
