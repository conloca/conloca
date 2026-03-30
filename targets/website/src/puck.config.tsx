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
import type { CTABannerProps, FeatureCardsProps, HeroProps, StepsProps } from './components/puck/sections';
import { CTABanner, FeatureCards, Hero, Steps } from './components/puck/sections';

type Components = {
  Badge: BadgeProps;
  Button: ButtonProps;
  CTABanner: CTABannerProps;
  Divider: DividerProps;
  FeatureCards: FeatureCardsProps;
  Flex: FlexProps;
  Grid: GridProps;
  Heading: HeadingProps;
  Hero: HeroProps;
  Image: ImageProps;
  Space: SpaceProps;
  Steps: StepsProps;
  Text: TextProps;
};

const puckConfig: Config<Components> = {
  categories: {
    sections: {
      title: 'Page Sections',
      defaultExpanded: true,
      components: ['Hero', 'FeatureCards', 'Steps', 'CTABanner'],
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
    CTABanner,
    Divider,
    FeatureCards,
    Flex: { ...Flex, label: 'Flex Container' },
    Grid: { ...Grid, label: 'Grid Container' },
    Heading,
    Hero,
    Image,
    Space: { ...Space, label: 'Spacer' },
    Steps,
    Text,
  },
};

export default puckConfig;
