import type { Config } from '@puckeditor/core';
// Import types
import type { ButtonProps } from './components/puck/Button';
import { Button } from './components/puck/Button';
import type { CardProps } from './components/puck/Card';
import { Card } from './components/puck/Card';
import type { FlexProps } from './components/puck/Flex';
import { Flex } from './components/puck/Flex';
import type { GridProps } from './components/puck/Grid';
import { Grid } from './components/puck/Grid';
import type { HeadingProps } from './components/puck/Heading';
import { Heading } from './components/puck/Heading';
import type { HeroProps } from './components/puck/Hero';
import { Hero } from './components/puck/Hero';
import type { SpaceProps } from './components/puck/Space';
import { Space } from './components/puck/Space';
import type { StatsProps } from './components/puck/Stats';
import { Stats } from './components/puck/Stats';
import type { TextProps } from './components/puck/Text';
import { Text } from './components/puck/Text';

// Define component types
type Components = {
  Button: ButtonProps;
  Card: CardProps;
  Grid: GridProps;
  Hero: HeroProps;
  Heading: HeadingProps;
  Flex: FlexProps;
  Stats: StatsProps;
  Text: TextProps;
  Space: SpaceProps;
};

// Use Config<Components> for full type safety
const puckConfig: Config<Components> = {
  categories: {
    layout: {
      components: ['Grid', 'Flex', 'Space'],
    },
    typography: {
      components: ['Heading', 'Text'],
    },
    interactive: {
      title: 'Actions',
      components: ['Button'],
    },
    other: {
      title: 'Other',
      components: ['Card', 'Hero', 'Stats'],
    },
  },
  components: {
    Button,
    Card,
    Grid,
    Hero,
    Heading,
    Flex,
    Stats,
    Text,
    Space,
  },
};

export default puckConfig;
