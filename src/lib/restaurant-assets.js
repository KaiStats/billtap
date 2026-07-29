/**
 * Imagery for the /restaurants landing page.
 *
 * These were generated with Higgsfield (Nano Banana 2) and currently point at
 * Higgsfield's CDN. Nothing on the page depends on them — every section has a
 * CSS-composed fallback underneath, so a dead URL degrades to the gradient
 * treatment rather than a broken box.
 *
 * To self-host (recommended before you drive real traffic here):
 *   curl -o public/img/restaurants-hero.png "<hero url below>"
 *   curl -o public/img/restaurants-detail.png "<detail url below>"
 * then swap the values for '/img/restaurants-hero.png' and
 * '/img/restaurants-detail.png'. No other file changes.
 */

const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5';

export const HERO_IMAGE = `${CDN}/hf_20260729_145319_1db26e63-a913-47d4-af26-0c55a6a8ae7e.png`;

export const DETAIL_IMAGE = `${CDN}/hf_20260729_145616_4a63691c-b043-4ed2-9e77-a054b53fbdb5.png`;
