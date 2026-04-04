/**
 * Kajabi API Client
 *
 * Makes direct HTTP requests to Kajabi's internal API.
 * No browser needed — uses JWT token from auth module.
 */

import { getSiteId } from './config.js';
import { USER_AGENT } from './constants.js';

const BASE_URL = 'https://app.kajabi.com';

export class KajabiClient {
  constructor(token, { siteId = null, csrfToken = null, cookieHeader = null } = {}) {
    siteId = siteId || getSiteId();
    this.token = token;
    this.siteId = siteId;
    this.csrfToken = csrfToken;
    this.baseHeaders = {
      'authorization': token,
      'accept': 'application/json',
      'user-agent': USER_AGENT,
    };
    if (cookieHeader) {
      this.baseHeaders['cookie'] = cookieHeader;
    }
  }

  async request(path, { method = 'GET', body = null, params = {}, headers = {} } = {}) {
    const url = new URL(path, BASE_URL);

    // Add site_id param if not in path and endpoint expects it
    if (!path.includes(this.siteId) && !params.site_id) {
      params.site_id = this.siteId;
    }

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }

    const reqHeaders = { ...this.baseHeaders, ...headers };

    if (body && method !== 'GET') {
      reqHeaders['content-type'] = 'application/json';
      if (this.csrfToken) {
        reqHeaders['x-csrf-token'] = this.csrfToken;
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Kajabi API ${method} ${path}: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      return res.json();
    }
    return res.text();
  }

  // ─── Site Info ───

  async getSite() {
    return this.request(`/api/admin/sites/${this.siteId}`);
  }

  // ─── Dashboard ───

  async getLifetimeRevenue() {
    return this.request('/api/dashboard/lifetime_net_revenue');
  }

  async getAlerts() {
    return this.request('/api/dashboard/alerts');
  }

  async getOfferPurchasesOverTime({ startDate, endDate, comparisonStartDate, comparisonEndDate, currency = 'USD' } = {}) {
    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000);
    return this.request('/api/dashboard/offer_purchases_over_time', {
      params: {
        currency,
        current_period_start_date: (startDate || weekAgo.toISOString().slice(0, 10)),
        current_period_end_date: (endDate || now.toISOString().slice(0, 10)),
        comparison_period_start_date: comparisonStartDate || undefined,
        comparison_period_end_date: comparisonEndDate || undefined,
      },
    });
  }

  async getMrrOverTime({ startDate, endDate, currency = 'USD' } = {}) {
    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000);
    const start = startDate || weekAgo.toISOString().slice(0, 10);
    const end = endDate || now.toISOString().slice(0, 10);
    // Calculate comparison period (same length, immediately prior)
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const periodMs = endMs - startMs;
    const compStart = new Date(startMs - periodMs).toISOString().slice(0, 10);
    const compEnd = new Date(startMs - 86400000).toISOString().slice(0, 10);
    return this.request('/api/dashboard/subscriptions_mrr_over_time', {
      params: {
        currency,
        current_period_start_date: start,
        current_period_end_date: end,
        comparison_period_start_date: compStart,
        comparison_period_end_date: compEnd,
      },
    });
  }

  // ─── Reports ───

  async getRevenueReport({ startDate, endDate, currency = 'USD' } = {}) {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    return this.request('/api/client/reports/payments_over_time', {
      params: {
        start_date: startDate || monthAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
        currency,
      },
    });
  }

  async exportRevenue({ startDate, endDate, currency = 'USD' } = {}) {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    return this.request('/api/client/reports/payments_over_time/export', {
      params: {
        start_date: startDate || monthAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
        currency,
      },
    });
  }

  async getRefundsReport({ startDate, endDate, currency = 'USD' } = {}) {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    return this.request('/api/client/reports/refunds_over_time', {
      params: {
        start_date: startDate || monthAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
        currency,
      },
    });
  }

  async getOffersSoldReport({ startDate, endDate } = {}) {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    return this.request('/api/client/reports/offers_sold', {
      params: {
        start_date: startDate || monthAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
        send_to_background: true,
      },
    });
  }

  async getOptInsReport({ startDate, endDate, frequency = 'day' } = {}) {
    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000);
    return this.request('/api/client/reports/opt_ins', {
      params: {
        start_date: startDate || weekAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
        frequency,
        send_to_background: true,
      },
    });
  }

  async getPageViewsReport({ startDate, endDate } = {}) {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    return this.request('/api/client/reports/page_views', {
      params: {
        start_date: startDate || monthAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
        send_to_background: true,
      },
    });
  }

  // ─── Transactions (per-purchase detail) ───

  async getTransactions({ page = 1, sort = 'date', direction = 'desc', inTheLast = '30_days', startDate, endDate, offerId, status } = {}) {
    const params = { page, sort, direction, site_id: undefined };
    if (startDate && endDate) {
      params.in_the_last = 'custom';
      params.start_date = startDate;
      params.end_date = endDate;
    } else {
      params.in_the_last = inTheLast;
    }
    if (offerId) params.offer_id = offerId;
    if (status) params.status = status;
    return this.request(`/admin/api/sites/${this.siteId}/payments/transactions`, { params });
  }

  async getTransactionCount({ inTheLast = '30_days' } = {}) {
    return this.request(`/admin/api/sites/${this.siteId}/payments/transactions/count`, {
      params: { in_the_last: inTheLast, site_id: undefined },
    });
  }

  async getTransactionFilters() {
    return this.request(`/admin/api/sites/${this.siteId}/payments/transaction_filters`, {
      params: { site_id: undefined },
    });
  }

  async getPaymentsByOffer({ startDate, endDate } = {}) {
    const now = new Date();
    const monthAgo = new Date(now - 30 * 86400000);
    return this.request('/api/reports/payments_by_offer', {
      params: {
        start_date: startDate || monthAgo.toISOString().slice(0, 10),
        end_date: endDate || now.toISOString().slice(0, 10),
      },
    });
  }

  // ─── Email Broadcast Drafting ───

  /**
   * Create a new email broadcast draft.
   * Returns the broadcast ID from the redirect URL.
   */
  async createEmailBroadcast(title) {
    const csrfToken = await this._getCsrfToken();
    const formBody = new URLSearchParams({
      'authenticity_token': csrfToken,
      'email_broadcast[title]': title,
    });

    const res = await fetch(`${BASE_URL}/admin/sites/${this.siteId}/email_broadcasts`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'accept': 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
      redirect: 'manual',
    });

    // 302 redirect to /admin/email_broadcasts/{id}/edit
    const location = res.headers.get('location') || '';
    const idMatch = location.match(/email_broadcasts\/(\d+)/);
    if (!idMatch) {
      throw new Error(`Failed to create broadcast (status ${res.status}). Location: ${location}`);
    }
    return idMatch[1];
  }

  /**
   * Update an email broadcast draft (subject, body, etc.)
   */
  async updateEmailBroadcast(broadcastId, { title, subject, body, previewText } = {}) {
    const csrfToken = await this._getCsrfTokenFrom(`/admin/email_broadcasts/${broadcastId}/edit`);
    const formData = new URLSearchParams({
      '_method': 'patch',
      'authenticity_token': csrfToken,
      'email_broadcast[emailable_notices]': JSON.stringify({
        capitalization: 0, punctuation: 0, phrase: 0, character_count: 0, total: 0,
      }),
    });
    if (title) formData.set('email_broadcast[title]', title);
    if (subject) formData.set('email_broadcast[subject]', subject);
    if (body !== undefined) formData.set('email_broadcast[body]', body || '');
    if (previewText) formData.set('email_broadcast[preview_text]', previewText);

    const res = await fetch(`${BASE_URL}/admin/email_broadcasts/${broadcastId}`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'accept': 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    if (res.status !== 302 && res.status !== 200) {
      throw new Error(`Failed to update broadcast ${broadcastId}: ${res.status}`);
    }
    return true;
  }

  /**
   * Set recipients/segment for a broadcast.
   */
  async setEmailRecipients(broadcastId, { segment } = {}) {
    const csrfToken = await this._getCsrfTokenFrom(`/admin/email_broadcasts/${broadcastId}/recipients`);
    const formData = new URLSearchParams({
      '_method': 'patch',
      'authenticity_token': csrfToken,
    });
    if (segment) formData.set('segment', segment);

    const res = await fetch(`${BASE_URL}/admin/email_broadcasts/${broadcastId}/recipients`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'accept': 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    if (res.status !== 302 && res.status !== 200) {
      throw new Error(`Failed to set recipients for broadcast ${broadcastId}: ${res.status}`);
    }
    return true;
  }

  /**
   * Get a CSRF token from a specific Kajabi admin page.
   * Rails uses per-session CSRF tokens, but we fetch from the target page
   * to ensure the token matches the form action.
   */
  async _getCsrfTokenFrom(path) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        ...this.baseHeaders,
        'accept': 'text/html',
      },
    });
    const html = await res.text();
    const match = html.match(/name="csrf-token"\s+content="([^"]+)"/);
    if (!match) throw new Error(`Could not extract CSRF token from ${path}`);
    return match[1];
  }

  async _getCsrfToken() {
    return this._getCsrfTokenFrom(`/admin/sites/${this.siteId}/email_broadcasts/new`);
  }

  // ─── Blog Posts ───

  /**
   * List blog tags.
   */
  async getBlogTags() {
    return this.request(`/admin/sites/${this.siteId}/blog/tags`, {
      headers: {
        'accept': '*/*',
        'x-requested-with': 'XMLHttpRequest',
        'x-csrf-token': this.csrfToken,
      },
      params: { site_id: undefined },
    });
  }

  /**
   * Create a new blog post draft.
   * Returns the post ID from the redirect URL.
   */
  async createBlogPost({ title, content, slug, pageTitle, pageDescription, publishedMode = 'unpublished', tags } = {}) {
    const csrfToken = await this._getCsrfTokenFrom(`/admin/sites/${this.siteId}/blog_posts/new`);
    const formBody = new URLSearchParams({
      'authenticity_token': csrfToken,
      'blog_post[title]': title || 'Untitled',
      'blog_post[content]': content || '',
      'blog_post[slug]': slug || '',
      'blog_post[page_title]': pageTitle || '',
      'blog_post[page_description]': pageDescription || '',
      'blog_post[page_image]': '',
      'blog_post[published_mode]': publishedMode,
      'blog_post[published_at]': '',
      'blog_post[wistia_video_id]': '',
      'blog_post[wistia_audio_id]': '',
    });
    if (tags) {
      formBody.set('blog_post[tag_list]', tags);
    }

    const res = await fetch(`${BASE_URL}/admin/sites/${this.siteId}/blog_posts`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'accept': 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
      redirect: 'manual',
    });

    const location = res.headers.get('location') || '';
    const idMatch = location.match(/blog_posts\/(\d+)/);
    if (!idMatch) {
      throw new Error(`Failed to create blog post (status ${res.status}). Location: ${location}`);
    }
    return idMatch[1];
  }

  /**
   * Update an existing blog post.
   */
  async updateBlogPost(postId, { title, content, slug, pageTitle, pageDescription, publishedMode, tags } = {}) {
    const csrfToken = await this._getCsrfTokenFrom(`/admin/sites/${this.siteId}/blog_posts/${postId}/edit`);
    const formData = new URLSearchParams({
      '_method': 'patch',
      'authenticity_token': csrfToken,
    });
    if (title !== undefined) formData.set('blog_post[title]', title);
    if (content !== undefined) formData.set('blog_post[content]', content);
    if (slug !== undefined) formData.set('blog_post[slug]', slug);
    if (pageTitle !== undefined) formData.set('blog_post[page_title]', pageTitle);
    if (pageDescription !== undefined) formData.set('blog_post[page_description]', pageDescription);
    if (publishedMode !== undefined) formData.set('blog_post[published_mode]', publishedMode);
    if (tags !== undefined) formData.set('blog_post[tag_list]', tags);

    const res = await fetch(`${BASE_URL}/admin/sites/${this.siteId}/blog_posts/${postId}`, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        'accept': 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    if (res.status !== 302 && res.status !== 200) {
      throw new Error(`Failed to update blog post ${postId}: ${res.status}`);
    }
    return true;
  }

  // ─── Offers / Commerce ───

  async getOffers() {
    return this.request('/api/admin/commerce/offers/');
  }

  async getSalesStats() {
    return this.request('/api/admin/commerce/offers/sales_stats');
  }

  async getProducts() {
    return this.request('/api/admin/commerce/products');
  }

  // ─── Contacts ───

  async getContacts(params = {}) {
    return this.request('/api/admin/contacts', { params });
  }

  async getSegments() {
    return this.request(`/api/admin/sites/${this.siteId}/segments`);
  }

  // ─── Email Campaigns ───

  async getEmailCampaigns({ page = 1, search = '', status = '' } = {}) {
    return this.request('/api/v1/admin/email_campaigns', {
      params: { page, search, status, by_emailable_type: '' },
    });
  }

  async getEmailCampaignStats(campaignIds) {
    const params = new URLSearchParams();
    params.set('site_id', this.siteId);
    for (const id of campaignIds) {
      params.append('email_campaign_ids[]', id);
    }
    const url = `/api/v1/admin/email_campaigns/stats?${params.toString()}`;
    return this.request(url, { params: {} }); // params already in URL
  }

  // ─── Newsletter ───

  async getNewsletter() {
    return this.request('/api/admin/newsletter');
  }
}
