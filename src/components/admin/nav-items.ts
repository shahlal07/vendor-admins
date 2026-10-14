export type NavItem = {
  label: string;
  href: string;
  section: 'Main' | 'Management' | 'Insights' | 'Settings';
  adminOnly?: boolean;
};

// Single source of truth for the sidebar. Pages not built yet in the
// current phase still get a real route (a "coming in Phase N" stub) so
// nothing in the nav is ever a dead link.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin', section: 'Main' },
  { label: 'Billing & invoices', href: '/billing', section: 'Main' },
  { label: 'Products', href: '/admin/products', section: 'Main' },
  { label: 'Orders', href: '/admin/orders', section: 'Main' },
  { label: 'Customers', href: '/admin/customers', section: 'Main' },
  { label: 'Varieties & Seasons', href: '/admin/varieties', section: 'Management' },
  { label: 'Inventory', href: '/admin/inventory', section: 'Management' },
  {
    label: 'Profit Calculator',
    href: '/admin/profit-calculator',
    section: 'Management',
  },
  { label: 'Shipping', href: '/admin/shipping', section: 'Management', adminOnly: true },
  { label: 'Coupons', href: '/admin/coupons', section: 'Management', adminOnly: true },
  { label: 'Reviews', href: '/admin/reviews', section: 'Management' },
  { label: 'Support', href: '/admin/support', section: 'Main' },
  { label: 'Report a Bug', href: '/admin/report-bug', section: 'Settings' },
  { label: 'Rewards & Referrals', href: '/admin/loyalty', section: 'Insights', adminOnly: true },
  { label: 'Announcements', href: '/admin/announcements', section: 'Insights', adminOnly: true },
  { label: 'Analytics', href: '/admin/analytics', section: 'Insights' },
  { label: 'Reports', href: '/admin/reports', section: 'Insights' },
  { label: 'AI Assistant', href: '/admin/assistant', section: 'Insights' },
  { label: 'Audit Log', href: '/admin/audit-log', section: 'Settings', adminOnly: true },
  { label: 'Staff', href: '/admin/staff', section: 'Settings', adminOnly: true },
  { label: 'Settings', href: '/admin/settings', section: 'Settings', adminOnly: true },
  { label: 'Website Content', href: '/admin/settings/content', section: 'Settings', adminOnly: true },
];
