/** Customers only see their own orders; admins see everything. */
export function shouldDeliver(event, user) {
  if (event.type === 'catalog.updated') return true;
  return user.role === 'admin' || event.userId === user.id;
}
