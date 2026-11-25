"""
Standard pagination for PetroERP.

Referenced from settings.py as:

    REST_FRAMEWORK = {
        ...
        'DEFAULT_PAGINATION_CLASS': 'api.pagination.StandardPagination',
        'PAGE_SIZE': 25,
    }

Behaviour:
  * default page size 25, maximum 500 (so listAll() in the frontend can pull a whole dropdown in one go)
  * optional ?page_size= querystring to override the size per request
  * response shape matches DRF's PageNumberPagination:
        {"count": N, "next": url|null, "previous": url|null, "results": [...]}
    which is exactly what the frontend's api.js `plain()` / `listAll()` expect.
"""
from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 500
    page_query_param = 'page'