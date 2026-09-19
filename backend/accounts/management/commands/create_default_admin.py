import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    """Create the default administrator account if it does not exist.

    Credentials come from environment variables (RAFFLE_ADMIN_USERNAME /
    RAFFLE_ADMIN_PASSWORD) or fall back to admin / admin123 for local dev.
    """

    help = "Create the default administrator account if missing."

    def handle(self, *args, **options):
        User = get_user_model()
        username = os.environ.get("RAFFLE_ADMIN_USERNAME", "admin")
        password = os.environ.get("RAFFLE_ADMIN_PASSWORD", "admin123")
        email = os.environ.get("RAFFLE_ADMIN_EMAIL", "admin@example.com")

        if User.objects.filter(username=username).exists():
            self.stdout.write(self.style.WARNING(f"Admin '{username}' already exists."))
            return

        User.objects.create_superuser(username=username, email=email, password=password)
        self.stdout.write(
            self.style.SUCCESS(
                f"Created administrator '{username}'. "
                "Change the password immediately in a real deployment."
            )
        )