import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ContentEntry, CreateContentInput, CreateResult, UpdateLocaleInput } from '@conloca/content-api';
import { ContentAPIClient, StaleWriteError } from '../src/client';

describe('ContentAPIClient', () => {
  let client: ContentAPIClient;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(() => Promise.resolve(new Response()));
    global.fetch = fetchMock as any;
    client = new ContentAPIClient();
  });

  describe('getContent', () => {
    it('should fetch content by ID', async () => {
      const mockContent: ContentEntry = {
        id: 'test-id',
        site: 'test-site',
        collection: 'pages',
        type: 'puck',
        kind: 'page',
        locales: {
          en: {
            locale: 'en',
            etag: 'metaHash.contentHash',
            created: '2024-01-01T00:00:00Z',
            modified: '2024-01-01T00:00:00Z',
            pathname: '/test',
            meta: {
              title: 'Test',
            },
            content: { puckData: {} },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockContent), { status: 200 }));

      const result = await client.getContent('test-id');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/content/test-id');
      expect(result?.id).toBe('test-id');
      expect(result?.site).toBe('test-site');
      expect(result?.locales.en?.pathname).toBe('/test');
    });

    it('should return null for 404', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }));

      const result = await client.getContent('non-existent');

      expect(result).toBeNull();
    });

    it('should throw on other errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Server error', { status: 500 }));

      await expect(client.getContent('test-id')).rejects.toThrow('Failed to fetch content');
    });
  });

  describe('createContent', () => {
    it('should create content', async () => {
      const createData: CreateContentInput = {
        kind: 'page',
        site: 'test-site',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/new',
            meta: {
              title: 'New Page',
            },
            content: { puckData: {} },
          },
        },
      };

      const mockResult: CreateResult = {
        success: true,
        id: 'new-id',
        etag: 'newMetaHash.newContentHash',
        created: new Date('2024-01-01T00:00:00.000Z'),
      };

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...mockResult,
            created: mockResult.created?.toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const result = await client.createContent(createData);

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/content', {
        method: 'POST',
        body: JSON.stringify(createData),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result.success).toBe(true);
      expect(result.id).toBe('new-id');
      expect(result.etag).toBe('newMetaHash.newContentHash');
      expect(result.created).toBeDefined();
    });
  });

  describe('updateLocalized', () => {
    it('should update localized content', async () => {
      const updateInput: UpdateLocaleInput = {
        id: 'test-id',
        locale: 'en',
        data: {
          content: { puckData: { updated: true } },
          meta: {
            title: 'Updated Title',
          },
        },
        etag: 'oldMetaHash.oldContentHash',
      };

      const mockResult = {
        success: true,
        etag: 'updatedMetaHash.updatedContentHash',
        modified: new Date('2024-01-01T00:00:00.000Z'),
      };

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...mockResult,
            modified: mockResult.modified.toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const result = await client.updateLocalized(updateInput);

      expect(fetchMock).toHaveBeenCalledWith(
        '/__conloca/api/content/test-id?locale=en&etag=oldMetaHash.oldContentHash',
        {
          method: 'PUT',
          body: JSON.stringify(updateInput.data),
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.success).toBe(true);
      expect(result.etag).toBe('updatedMetaHash.updatedContentHash');
    });

    it('should throw StaleWriteError on 412', async () => {
      const errorData = {
        error: {
          code: 'STALE_WRITE',
          message: 'Content has been modified',
          details: {
            currentEtag: 'currentMetaHash.currentContentHash',
          },
        },
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(errorData), {
          status: 412,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(
        client.updateLocalized({
          id: 'test-id',
          locale: 'en',
          data: {},
          etag: 'staleMetaHash.staleContentHash',
        }),
      ).rejects.toThrow(StaleWriteError);
    });
  });

  describe('deleteContent', () => {
    it('should delete content', async () => {
      const mockResult = { success: true };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await client.deleteContent('test-id', 'metaHash.contentHash');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/content/test-id', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': 'metaHash.contentHash',
        },
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('site operations', () => {
    it('should get site pages', async () => {
      const mockResult = { items: [], total: 0 };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResult), { status: 200 }));

      const result = await client.getSitePages('test-site', 'en');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/test-site/pages?locale=en', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('should check pathname availability', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), { status: 200 }));

      const result = await client.isPathnameAvailable('test-site', '/new-path', 'exclude-id');

      expect(fetchMock).toHaveBeenCalledWith(
        '/__conloca/api/test-site/pathname-available?pathname=%2Fnew-path&excludeId=exclude-id',
      );
      expect(result).toBe(true);
    });
  });

  describe('block operations', () => {
    it('should get blocks with filters', async () => {
      const mockResult = { items: [], total: 0 };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResult), { status: 200 }));

      const result = await client.getBlocks('components', 'en');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/blocks?collection=components&locale=en', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('global operations', () => {
    it('should list all content with filters', async () => {
      const mockResult = { items: [], total: 0 };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResult), { status: 200 }));

      const result = await client.listAllContent({
        site: 'test-site',
        type: 'puck',
        published: true,
      });

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/content?site=test-site&type=puck&published=true', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('should batch update', async () => {
      const operations: UpdateLocaleInput[] = [
        { id: 'id1', locale: 'en', data: { meta: { title: 'New Title 1' } }, etag: 'meta1.content1' },
        { id: 'id2', locale: 'en', data: { meta: { title: 'New Title 2' } }, etag: 'meta2.content2' },
      ];

      const mockResult = {
        success: true,
        updated: 2,
        failed: 0,
        operations: [
          { id: 'id1', locale: 'en', updated: true },
          { id: 'id2', locale: 'en', updated: true },
        ],
      };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResult), { status: 200 }));

      const result = await client.batchUpdate(operations);

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/content/batch', {
        method: 'POST',
        body: JSON.stringify({ operations }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('custom base URL', () => {
    it('should use custom base URL', async () => {
      const customClient = new ContentAPIClient({ baseUrl: '/custom/api' });

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), { status: 200 }));

      await customClient.isPathnameAvailable('site', '/path');

      expect(fetchMock).toHaveBeenCalledWith('/custom/api/site/pathname-available?pathname=%2Fpath');
    });
  });
});
