import type { ContentEntry, CreateContentInput, CreateResult, UpdateLocaleInput } from '@conloca/content-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentAPIClient, StaleWriteError } from '../src/client';

describe('ContentAPIClient', () => {
  let client: ContentAPIClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(new Response()));
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

    it('should compile MDX through the API', async () => {
      const mockResult = {
        code: 'return { default: function Test() { return null } };',
        metadata: { title: 'Test block' },
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await client.compileMDX('# Test block');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/mdx/compile', {
        method: 'POST',
        body: JSON.stringify({ mdxContent: '# Test block' }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw APIClientError when MDX compilation fails', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'MDX_COMPILE_FAILED',
              message: 'Failed to compile MDX',
            },
          }),
          {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      await expect(client.compileMDX('# broken {')).rejects.toMatchObject({
        code: 'MDX_COMPILE_FAILED',
        message: 'Failed to compile MDX',
      });
    });
  });

  describe('data operations', () => {
    it('should get data with filters', async () => {
      const mockResult = { items: [], total: 0 };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResult), { status: 200 }));

      const result = await client.getData('authors', 'en');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/data?collection=authors&locale=en', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('should get data without filters', async () => {
      const mockResult = { items: [], total: 0 };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockResult), { status: 200 }));

      const result = await client.getData();

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/data', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockResult);
    });

    it('should get data entry by name', async () => {
      const mockEntry = {
        id: 'vx-data123',
        kind: 'data',
        type: 'json',
        collection: 'authors',
        locales: {
          en: {
            locale: 'en',
            etag: 'meta.content',
            name: 'john-doe',
            meta: { title: 'John Doe' },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockEntry), { status: 200 }));

      const result = await client.getDataByName('john-doe', 'authors', 'en');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/data/john-doe?collection=authors&locale=en');
      expect(result?.id).toBe('vx-data123');
    });

    it('should return null for non-existent data entry', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }));

      const result = await client.getDataByName('non-existent', 'authors');

      expect(result).toBeNull();
    });

    it('should check data name availability', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ available: true }), { status: 200 }));

      const result = await client.isDataNameAvailable('new-name', 'authors', 'exclude-id');

      expect(fetchMock).toHaveBeenCalledWith(
        '/__conloca/api/data/name-available?name=new-name&collection=authors&excludeId=exclude-id',
      );
      expect(result).toBe(true);
    });

    it('should check data name availability without excludeId', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ available: false }), { status: 200 }));

      const result = await client.isDataNameAvailable('taken-name', 'authors');

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/data/name-available?name=taken-name&collection=authors');
      expect(result).toBe(false);
    });

    it('should get data collections', async () => {
      const mockCollections = { collections: ['authors', 'testimonials', 'settings'] };

      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mockCollections), { status: 200 }));

      const result = await client.getDataCollections();

      expect(fetchMock).toHaveBeenCalledWith('/__conloca/api/data/collections', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(['authors', 'testimonials', 'settings']);
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
