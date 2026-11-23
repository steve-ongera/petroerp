"""
PetroERP settings. Configuration comes from environment variables (see .env.example).
Production checklist: DEBUG=0, strong SECRET_KEY, PostgreSQL, HTTPS, restricted CORS_ORIGINS.
"""
import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(key, default=None):
    return os.environ.get(key, default)


DEBUG = env('DEBUG', '1') == '1'
SECRET_KEY = env('SECRET_KEY', 'dev-only-change-me-' + 'x' * 40)


if not DEBUG and SECRET_KEY.startswith('dev-only'):
    raise RuntimeError('Set a strong SECRET_KEY when DEBUG=0.')


ALLOWED_HOSTS = env('ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',')

INSTALLED_APPS = [
    'django.contrib.admin', 
    'django.contrib.auth',
    'django.contrib.contenttypes', 
    'django.contrib.sessions',
    'django.contrib.messages', 
    'django.contrib.staticfiles',
    'rest_framework', 
    'django_filters', 'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'

WSGI_APPLICATION = 'backend.wsgi.application'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [], 'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request', 'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages']},
}]

# ---- database: SQLite for development, PostgreSQL for production (DB_NAME set)
if env('DB_NAME'):
    DATABASES = {'default': {
        'ENGINE': 'django.db.backends.postgresql', 'NAME': env('DB_NAME'), 'USER': env('DB_USER', 'backend'),
        'PASSWORD': env('DB_PASSWORD', ''), 'HOST': env('DB_HOST', 'localhost'), 'PORT': env('DB_PORT', '5432'),
        'ATOMIC_REQUESTS': True,            # every request is one DB transaction -> no half-posted financial data
    }}
else:
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3', 'ATOMIC_REQUESTS': True}}

AUTH_USER_MODEL = 'api.User'


AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'

TIME_ZONE = env('TIME_ZONE', 'Africa/Nairobi')
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024



REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_PAGINATION_CLASS': 'api.pagination.StandardPagination',
    'EXCEPTION_HANDLER': 'api.views.api_exception_handler',
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.ScopedRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {'login': env('LOGIN_THROTTLE', '10/min')},
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=int(env('ACCESS_MINUTES', '30'))),
    'REFRESH_TOKEN_LIFETIME': timedelta(hours=int(env('REFRESH_HOURS', '12'))),
    'ROTATE_REFRESH_TOKENS': True,
}


CORS_ALLOWED_ORIGINS = env('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')


REPORTING_CURRENCY = env('REPORTING_CURRENCY', 'USD')     # group consolidation / dashboard currency

if not DEBUG:
    SECURE_SSL_REDIRECT = env('SECURE_SSL_REDIRECT', '1') == '1'
    SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')