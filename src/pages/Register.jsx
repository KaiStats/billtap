import { Navigate, useLocation } from "react-router-dom";

/**
 * There is no separate sign-up any more.
 *
 * `signInWithOtp` creates the account if the address does not have one, so
 * "register" and "sign in" are the same action. Two screens asking for the same
 * single field, one of which errors if you are already a customer, is a choice
 * the person should not have to make.
 *
 * The route stays because it is linked from the marketing pages and sits in
 * people's history. It redirects rather than 404s, and carries the query string
 * so a ?next= survives.
 */
export default function Register() {
  const { search } = useLocation();
  return <Navigate to={`/login${search}`} replace />;
}
