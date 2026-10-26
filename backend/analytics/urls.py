from django.urls import path

from . import views
from .auth import admin_views, views as auth_views

urlpatterns = [
    # ---- authentication
    path('api/auth/login', auth_views.login),
    path('api/auth/logout', auth_views.logout),
    path('api/auth/me', auth_views.me),
    path('api/auth/change-password', auth_views.change_password),
    path('api/auth/forgot-password', auth_views.forgot_password),
    path('api/auth/reset-password', auth_views.reset_password),
    # ---- administration (SUPERUSER only)
    path('api/admin/users', admin_views.users),
    path('api/admin/users/<str:user_id>', admin_views.user_detail),
    path('api/admin/users/<str:user_id>/activate', admin_views.user_activate),
    path('api/admin/users/<str:user_id>/force-password-change', admin_views.user_force_password_change),
    path('api/admin/users/<str:user_id>/reset-password', admin_views.user_reset_password),
    # ---- data
    path('api/status', views.status),
    path('api/connection-test', views.connection_test),
    path('api/data', views.data),
    path('api/lines', views.lines),
    path('api/validation', views.validation),
    path('api/batch/<str:batch_id>', views.batch),
    path('api/order/<str:order_id>', views.order),
    path('api/refresh', views.refresh),
    path('api/spreadsheet/load', views.spreadsheet_load),
    path('api/load-history', views.load_history),
    path('api/chat', views.chat),
    path('api/export/validation.csv', views.export_validation_csv),
]
