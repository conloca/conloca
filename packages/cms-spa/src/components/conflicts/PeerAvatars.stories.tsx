import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import '../../main.css';
import { createFakeDocChannel } from '../../../test/fake-doc-channel.js';
import type { PresencePeer } from '../../live/messages.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { PeerAvatars } from './PeerAvatars.js';

const DOC = 'mdx:web:home:en#1';
const NAMES = ['Maria Lopez', 'Ben Okafor', 'Ann', 'Chen Wei', 'Dana Fischer', 'Eli Moss'];
const peers: PresencePeer[] = NAMES.map((name, i) => ({
  clientId: i + 1,
  user: { id: `u${i + 2}`, name },
  selection: { blockId: null },
}));

/** The doc channel the avatars read presence from, holding `shown` as the page's peers. */
function withPeers(shown: PresencePeer[]) {
  return () => {
    const previous = getUIConfig();
    const { channel } = createFakeDocChannel({ mdx: '' });
    configureUI({ ...previous, docChannel: channel });
    channel.receive('presence.peers', { docKey: DOC, peers: shown });
    return () => configureUI(previous);
  };
}

const meta = {
  title: 'Live/PeerAvatars',
  component: PeerAvatars,
  args: { live: { docKey: DOC, user: { id: 'u1', name: 'Me' } } },
} satisfies Meta<typeof PeerAvatars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoPeople: Story = {
  beforeEach: withPeers(peers.slice(0, 2)),
  play: async ({ canvasElement }) => {
    const list = await within(canvasElement).findByRole('list', { name: 'People on this page' });
    await expect(within(list).getByRole('listitem', { name: 'Maria Lopez' })).toHaveTextContent('ML');
    await expect(within(list).getByRole('listitem', { name: 'Ben Okafor' })).toHaveTextContent('BO');
  },
};

export const SixPeople: Story = {
  beforeEach: withPeers(peers),
  play: async ({ canvasElement }) => {
    const list = await within(canvasElement).findByRole('list', { name: 'People on this page' });
    await expect(within(list).getByText('+2')).toBeVisible();
    await Promise.all(
      NAMES.slice(0, 4).map((name) => expect(within(list).getByRole('listitem', { name })).toBeInTheDocument()),
    );
    await expect(within(list).getByRole('listitem', { name: '2 more' })).toBeInTheDocument();
  },
};
