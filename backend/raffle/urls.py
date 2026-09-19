from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view(), name="dashboard"),
    path("tickets/", views.TicketListView.as_view(), name="ticket-list"),
    path(
        "reservations/",
        views.ReservationListCreateView.as_view(),
        name="reservation-list-create",
    ),
    path(
        "reservations/<int:pk>/",
        views.ReservationDetailView.as_view(),
        name="reservation-detail",
    ),
    path(
        "reservations/<int:pk>/cancel/",
        views.ReservationCancelView.as_view(),
        name="reservation-cancel",
    ),
    path("monitor/", views.MonitorView.as_view(), name="monitor"),
    path("settings/", views.SettingsView.as_view(), name="settings"),
    path(
        "settings/initialize-tickets/",
        views.InitializeTicketsView.as_view(),
        name="initialize-tickets",
    ),
    path("ticket-design/", views.TicketDesignView.as_view(), name="ticket-design"),
]