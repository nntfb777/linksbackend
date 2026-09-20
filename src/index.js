export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // 1. CẤU HÌNH CORS
    const ADMIN_ORIGINS = [
      'https://adm.79king.ai',
      'https://99okcode-admin.pages.dev'
    ];

    const isAdminOrigin = ADMIN_ORIGINS.includes(origin);

    const publicCorsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Site-ID',
      'Content-Type': 'application/json'
    };

    const adminCorsHeaders = {
      'Access-Control-Allow-Origin': isAdminOrigin ? origin : ADMIN_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Site-ID',
      'Access-Control-Allow-Credentials': 'true',
      'Content-Type': 'application/json'
    };

    const isAdminEndpoint = url.pathname.startsWith('/api/admin');
    const corsHeaders = isAdminEndpoint ? adminCorsHeaders : publicCorsHeaders;

    if (request.method === 'OPTIONS') {
      if (isAdminEndpoint && !isAdminOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { headers: corsHeaders });
    }

    // 2. MIDDLEWARE XÁC THỰC BẢO MẬT
    if (isAdminEndpoint && ['POST', 'DELETE'].includes(request.method)) {
      if (!isAdminOrigin) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden: Origin not allowed' }), {
          status: 403,
          headers: corsHeaders
        });
      }

      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.ADMIN_SECRET_KEY || "Admin@123!";

      if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Access Denied' }), {
          status: 401,
          headers: corsHeaders
        });
      }
    }

    // 3. LOGIC XỬ LÝ API
    try {
      const siteId = request.headers.get('X-Site-ID') || url.searchParams.get('site_id') || '99ok';

      // GET /api/config - Lấy cấu hình công khai (CÓ WORKERS CACHING)
      if (url.pathname === '/api/config' && request.method === 'GET') {
        const { results } = await env.DB99ok.prepare(
          "SELECT category, key_name, value, sort_order FROM site_configs WHERE site_id = ? AND is_active = 1 ORDER BY sort_order ASC"
        ).bind(siteId).all();

        const masterUrls = results.filter(r => r.category === 'ping_link').map(r => r.value);
        const banners = results.filter(r => r.category === 'banner_image').map(r => r.value);
        const systemLinks = {};
        const socialLinks = {};

        results.filter(r => r.category === 'system_link').forEach(r => {
          systemLinks[r.key_name] = r.value;
        });

        results.filter(r => r.category === 'social_link').forEach(r => {
          socialLinks[r.key_name] = r.value;
        });

        return new Response(JSON.stringify({
          success: true,
          site_id: siteId,
          data: { masterUrls, banners, systemLinks, socialLinks }
        }), {
          headers: {
            ...corsHeaders,
            'Cache-Control': 'public, max-age=300'  // ← TTL 300 giây = 5 phút
          }
        });
      }

      // GET /api/admin/links - Lấy danh sách đầy đủ cho Admin (KHÔNG CACHE)
      if (url.pathname === '/api/admin/links' && request.method === 'GET') {
        const { results } = await env.DB99ok.prepare(
          "SELECT * FROM site_configs WHERE site_id = ? ORDER BY category, sort_order ASC"
        ).bind(siteId).all();

        return new Response(JSON.stringify({ success: true, site_id: siteId, data: results }), { headers: corsHeaders });
      }

      // POST /api/admin/links - Thêm mới hoặc Cập nhật
      if (url.pathname === '/api/admin/links' && request.method === 'POST') {
        const { category, key_name, title, value, sort_order, is_active } = await request.json();

        if (!category || !key_name || !value) {
          return new Response(JSON.stringify({ success: false, error: 'Thiếu category, key_name hoặc value' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        await env.DB99ok.prepare(`
          INSERT INTO site_configs (id, site_id, category, key_name, title, value, sort_order, is_active, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(site_id, key_name) DO UPDATE SET
            category = excluded.category,
            title = excluded.title,
            value = excluded.value,
            sort_order = excluded.sort_order,
            is_active = excluded.is_active,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          crypto.randomUUID(),
          siteId,
          category,
          key_name,
          title || '',
          value,
          sort_order || 0,
          is_active !== undefined ? is_active : 1
        ).run();

        return new Response(JSON.stringify({ success: true, message: 'Cập nhật cấu hình thành công' }), { headers: corsHeaders });
      }

      // DELETE /api/admin/links - Xóa một cấu hình
      if (url.pathname === '/api/admin/links' && request.method === 'DELETE') {
        const key_name = url.searchParams.get('key_name');
        if (!key_name) {
          return new Response(JSON.stringify({ success: false, error: 'Thiếu key_name' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        await env.DB99ok.prepare("DELETE FROM site_configs WHERE site_id = ? AND key_name = ?")
          .bind(siteId, key_name).run();

        return new Response(JSON.stringify({ success: true, message: 'Xóa thành công' }), { headers: corsHeaders });
      }

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Endpoint Not Found' }), {
      status: 404,
      headers: corsHeaders
    });
  }
};
