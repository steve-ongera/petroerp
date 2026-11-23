"""App-level URLs (mounted at /api/ by petroerp/urls.py)."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import views as v

router = DefaultRouter()
for prefix, viewset in v.ROUTES:                       # every CRUD resource is registered in views.py
    router.register(prefix, viewset, basename=prefix)

urlpatterns = [
    # authentication
    path('auth/login/', v.LoginView.as_view(), name='login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('auth/me/', v.MeView.as_view(), name='me'),
    path('auth/mfa/', v.MfaView.as_view(), name='mfa'),
    path('meta/', v.MetaView.as_view(), name='meta'),

    # non-CRUD operations
    path('tax-configs/<int:pk>/verify/', v.TaxVerify.as_view(), name='tax-verify'),
    path('stock/<str:op>/', v.StockOps.as_view(), name='stock-ops'),            # transfer | opening
    path('pricing/calculate/', v.PricingView.as_view(), name='pricing'),
    path('group/revalue/', v.RevalueView.as_view(), name='fx-revalue'),
    path('dashboard/', v.DashboardView.as_view(), name='dashboard'),
    path('reports/', v.ReportListView.as_view(), name='report-list'),
    path('reports/<str:name>/', v.ReportView.as_view(), name='report'),
    path('ai/<str:op>/', v.AIView.as_view(), name='ai'),                       # ask | scan | cash-forecast | ...

    path('', include(router.urls)),
]