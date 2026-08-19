
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // 1. CẤU HÌNH CORS ĐỘNG (Đồng bộ với server.js)
    const allowedOrigins = [
      'http://localhost:5500',
      'https://99okcode-admin.pages.dev',
      'https://99okcode.pages.dev',
      'https://79kingcode.pages.dev',
      'https://okkingcode.pages.dev',
      'https://kl99code.pages.dev'
    ];

    const isAllowedOrigin = allowedOrigins.includes(origin);
    const corsHeaders = {
      'Access-Control-Allow-Origin': isAllowedOrigin ? origin : allowedOrigins[0],
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Site-ID',
      'Access-Control-Allow-Credentials': 'true',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. MIDDLEWARE XÁC THỰC BẢO MẬT (Chỉ áp dụng cho các phương thức ghi/xóa POST, DELETE)
    const authHeader = request.headers.get('Authorization');
    const expectedSecret = env.ADMIN_SECRET_KEY || "Admin@123!";

    if (['POST', 'DELETE'].includes(request.method)) {
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

      // GET /api/config - Lấy cấu hình công khai render thẳng cho Client (Vue App)
      if (url.pathname === '/api/config' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          "SELECT category, key_name, value, sort_order FROM site_configs WHERE site_id = ? AND is_active = 1 ORDER BY sort_order ASC"
        ).bind(siteId).all();

        // Bóc tách dữ liệu đúng định dạng cho main-app.js
        const masterUrls = results.filter(r => r.category === 'ping_link').map(r => r.value);
        const banners = results.filter(r => r.category === 'banner_image').map(r => r.value);
        const systemLinks = {};
        
        results.filter(r => r.category === 'system_link').forEach(r => {
          systemLinks[r.key_name] = r.value;
        });

        return new Response(JSON.stringify({
          success: true,
          site_id: siteId,
          data: {
            masterUrls,
            banners,
            systemLinks // kefuUrl, apkAppUrl, pcUrl...
          }
        }), { headers: corsHeaders });
      }

      // GET /api/admin/links - Lấy danh sách đầy đủ cho Trang Quản Lý Admin
      if (url.pathname === '/api/admin/links' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          "SELECT * FROM site_configs WHERE site_id = ? ORDER BY category, sort_order ASC"
        ).bind(siteId).all();

        return new Response(JSON.stringify({ success: true, site_id: siteId, data: results }), { headers: corsHeaders });
      }

      // POST /api/admin/links - Thêm mới hoặc Cập nhật Link / Banner
      if (url.pathname === '/api/admin/links' && request.method === 'POST') {
        const { category, key_name, title, value, sort_order, is_active } = await request.json();

        if (!category || !key_name || !value) {
          return new Response(JSON.stringify({ success: false, error: 'Thiếu category, key_name hoặc value' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        await env.DB.prepare(`
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
          category, // 'ping_link', 'system_link', 'banner_image'
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

        await env.DB.prepare("DELETE FROM site_configs WHERE site_id = ? AND key_name = ?")
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