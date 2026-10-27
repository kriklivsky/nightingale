#include <gtk/gtk.h>
#include <stdlib.h>
#include <string.h>

enum { LAUNCH_COUNT = 3, HDMI_ITEM = 3, UMC_ITEM = 4, NETWORK_ITEM = 5, ITEM_COUNT = 6 };

static GtkWidget *buttons[ITEM_COUNT];
static GtkWidget *audio_labels[2];
static GtkWidget *status_label;
static int selected = 0;
static int result = 1;
static gboolean changing_audio = FALSE;
static gboolean screen_running = FALSE;

static void screen_finished(GObject *source, GAsyncResult *response, gpointer data) {
    (void)data;
    GError *error = NULL;
    gboolean success = g_subprocess_wait_check_finish(G_SUBPROCESS(source), response, &error);
    screen_running = FALSE;
    GtkWidget *window = gtk_widget_get_toplevel(buttons[0]);
    gtk_widget_show_all(window);
    gtk_window_present(GTK_WINDOW(window));
    gdk_window_focus(gtk_widget_get_window(window), GDK_CURRENT_TIME);
    gtk_widget_grab_focus(buttons[selected]);
    if (!success) {
        gtk_label_set_text(GTK_LABEL(status_label), error != NULL ? error->message : "Приёмник экрана завершился с ошибкой");
    }
    g_clear_error(&error);
}

static void start_tool(const char *program) {
    GError *error = NULL;
    GSubprocess *process = g_subprocess_new(G_SUBPROCESS_FLAGS_NONE, &error, program, NULL);
    if (process == NULL) {
        gtk_label_set_text(GTK_LABEL(status_label), error->message);
        g_clear_error(&error);
        return;
    }
    screen_running = TRUE;
    gtk_widget_hide(gtk_widget_get_toplevel(buttons[0]));
    g_subprocess_wait_check_async(process, NULL, screen_finished, NULL);
    g_object_unref(process);
}

static void select_item(int item) {
    selected = CLAMP(item, 0, ITEM_COUNT - 1);
    for (int i = 0; i < ITEM_COUNT; i++) {
        GtkStyleContext *context = gtk_widget_get_style_context(buttons[i]);
        if (i == selected) {
            gtk_style_context_add_class(context, "selected");
        } else {
            gtk_style_context_remove_class(context, "selected");
        }
    }
    gtk_widget_grab_focus(buttons[selected]);
}

static void finish_audio_request(void) {
    changing_audio = FALSE;
    for (int i = 0; i < ITEM_COUNT; i++) {
        gtk_widget_set_sensitive(buttons[i], TRUE);
    }
    select_item(selected);
}

static void audio_finished(GObject *source, GAsyncResult *response, gpointer data) {
    GSubprocess *process = G_SUBPROCESS(source);
    gchar *output = NULL;
    gchar *errors = NULL;
    GError *error = NULL;
    gboolean communicated = g_subprocess_communicate_utf8_finish(
        process, response, &output, &errors, &error);
    const char *route = output != NULL ? g_strstrip(output) : "";
    gboolean valid = strcmp(route, "hdmi") == 0 || strcmp(route, "umc") == 0;

    if (communicated && g_subprocess_get_successful(process) && valid) {
        gboolean hdmi = strcmp(route, "hdmi") == 0;
        gtk_label_set_text(GTK_LABEL(audio_labels[0]), hdmi ? "✓ HDMI / саундбар" : "HDMI / саундбар");
        gtk_label_set_text(GTK_LABEL(audio_labels[1]), hdmi ? "UMC202HD / колонки" : "✓ UMC202HD / колонки");
        if (data != NULL) {
            gtk_label_set_text(GTK_LABEL(status_label), "Вывод сохранён для караоке и трансляции экрана");
        }
    } else {
        const char *message = error != NULL ? error->message :
            errors != NULL && *errors != '\0' ? g_strstrip(errors) : "Не удалось определить аудиовыход";
        gtk_label_set_text(GTK_LABEL(status_label), message);
    }
    g_clear_error(&error);
    g_free(output);
    g_free(errors);
    finish_audio_request();
}

static void request_audio(const char *output) {
    GError *error = NULL;
    GSubprocess *process = g_subprocess_new(
        G_SUBPROCESS_FLAGS_STDOUT_PIPE | G_SUBPROCESS_FLAGS_STDERR_PIPE,
        &error, "/usr/local/bin/tvbox-audio", output, NULL);
    if (process == NULL) {
        gtk_label_set_text(GTK_LABEL(status_label), error->message);
        g_clear_error(&error);
        return;
    }
    changing_audio = TRUE;
    for (int i = 0; i < ITEM_COUNT; i++) {
        gtk_widget_set_sensitive(buttons[i], FALSE);
    }
    g_subprocess_communicate_utf8_async(
        process, NULL, NULL, audio_finished, GINT_TO_POINTER(output != NULL));
    g_object_unref(process);
}

static void activate_item(int item) {
    if (changing_audio || screen_running) {
        return;
    }
    if (item == NETWORK_ITEM) {
        start_tool("/usr/local/bin/tvbox-network");
        return;
    }
    if (item >= LAUNCH_COUNT) {
        request_audio(item == HDMI_ITEM ? "hdmi" : "umc");
        return;
    }
    if (item == 1) {
        start_tool("/usr/local/bin/tvbox-screen");
        return;
    }
    static const int results[LAUNCH_COUNT] = {10, 20, 30};
    result = results[item];
    gtk_main_quit();
}

static void button_clicked(GtkButton *button, gpointer data) {
    (void)button;
    select_item(GPOINTER_TO_INT(data));
    activate_item(selected);
}

static gboolean key_pressed(GtkWidget *widget, GdkEventKey *event, gpointer data) {
    (void)widget;
    (void)data;
    if (changing_audio || screen_running) {
        return TRUE;
    }
    int first = selected < LAUNCH_COUNT ? 0 : HDMI_ITEM;
    int last = selected < LAUNCH_COUNT ? LAUNCH_COUNT - 1 : NETWORK_ITEM;
    switch (event->keyval) {
    case GDK_KEY_Left:
        select_item(MAX(first, selected - 1));
        return TRUE;
    case GDK_KEY_Right:
        select_item(MIN(last, selected + 1));
        return TRUE;
    case GDK_KEY_Up:
        if (selected >= LAUNCH_COUNT) {
            select_item(selected - LAUNCH_COUNT);
        }
        return TRUE;
    case GDK_KEY_Down:
        if (selected < LAUNCH_COUNT) {
            select_item(HDMI_ITEM + selected);
        }
        return TRUE;
    case GDK_KEY_Tab:
    case GDK_KEY_ISO_Left_Tab:
        select_item((selected + ((event->state & GDK_SHIFT_MASK) ? ITEM_COUNT - 1 : 1)) % ITEM_COUNT);
        return TRUE;
    case GDK_KEY_Return:
    case GDK_KEY_KP_Enter:
    case GDK_KEY_space:
        activate_item(selected);
        return TRUE;
    case GDK_KEY_Escape:
        gtk_label_set_text(GTK_LABEL(status_label),
                           "Удерживайте Back 2 секунды для выхода из приложения");
        return TRUE;
    default:
        return FALSE;
    }
}

static GtkWidget *make_button(const char *title, const char *description, int item) {
    GtkWidget *button = gtk_button_new();
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 14);
    GtkWidget *heading = gtk_label_new(NULL);
    GtkWidget *detail = gtk_label_new(description);
    char *markup = g_markup_printf_escaped("<span size='30000' weight='bold'>%s</span>", title);

    gtk_label_set_markup(GTK_LABEL(heading), markup);
    g_free(markup);
    gtk_label_set_line_wrap(GTK_LABEL(detail), TRUE);
    gtk_label_set_justify(GTK_LABEL(detail), GTK_JUSTIFY_CENTER);
    gtk_widget_set_halign(heading, GTK_ALIGN_CENTER);
    gtk_widget_set_halign(detail, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(box), heading, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(box), detail, FALSE, FALSE, 0);
    gtk_container_add(GTK_CONTAINER(button), box);
    gtk_widget_set_size_request(button, 430, 260);
    gtk_style_context_add_class(gtk_widget_get_style_context(button), "launch-button");
    g_signal_connect(button, "clicked", G_CALLBACK(button_clicked), GINT_TO_POINTER(item));
    return button;
}

static GtkWidget *make_audio_button(const char *title, int item) {
    GtkWidget *button = gtk_button_new();
    GtkWidget *label = gtk_label_new(title);
    audio_labels[item - LAUNCH_COUNT] = label;
    gtk_container_add(GTK_CONTAINER(button), label);
    gtk_style_context_add_class(gtk_widget_get_style_context(button), "audio-button");
    g_signal_connect(button, "clicked", G_CALLBACK(button_clicked), GINT_TO_POINTER(item));
    return button;
}

int main(int argc, char **argv) {
    gtk_init(&argc, &argv);

    GtkCssProvider *css = gtk_css_provider_new();
    const char *style =
        "window { background-image: linear-gradient(145deg, #07111f, #132744); color: #f5f7ff; }"
        "#title { color: #ffffff; }"
        "#subtitle, #audio-title { color: #a9bbd4; font-size: 19px; }"
        ".launch-button, .audio-button { background: rgba(20, 38, 65, 0.92); color: #ffffff;"
        " border: 3px solid rgba(123, 153, 194, 0.35); border-radius: 24px; padding: 36px; }"
        ".audio-button { padding: 18px 28px; font-size: 24px; }"
        ".launch-button:focus, .launch-button.selected, .audio-button:focus, .audio-button.selected {"
        " background: #1d4f82; border-color: #70d6ff; box-shadow: 0 0 24px #3bb7e8; }"
        "#status { color: #ffcf70; font-size: 16px; }";
    gtk_css_provider_load_from_data(css, style, -1, NULL);
    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);

    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    GtkWidget *outer = gtk_box_new(GTK_ORIENTATION_VERTICAL, 24);
    GtkWidget *title = gtk_label_new(NULL);
    GtkWidget *subtitle = gtk_label_new("← → Выбор · ↓ Звук и сеть · OK Подтвердить");
    GtkWidget *choices = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 28);
    GtkWidget *audio_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);
    GtkWidget *audio_title = gtk_label_new("Вывод звука");
    GtkWidget *audio_choices = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 24);
    status_label = gtk_label_new("");

    gtk_window_set_title(GTK_WINDOW(window), "Orange Pi TV");
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 720);
    gtk_window_fullscreen(GTK_WINDOW(window));
    gtk_widget_set_name(title, "title");
    gtk_widget_set_name(subtitle, "subtitle");
    gtk_widget_set_name(audio_title, "audio-title");
    gtk_widget_set_name(status_label, "status");
    gtk_label_set_line_wrap(GTK_LABEL(status_label), TRUE);
    gtk_label_set_markup(GTK_LABEL(title), "<span size='44000' weight='bold'>Orange Pi TV</span>");

    buttons[0] = make_button("Караоке", "Nightingale\nЛокальная медиатека и RKNN NPU", 0);
    buttons[1] = make_button("Экран ноутбука", "Локальный WebRTC\nЭкран, вкладка и звук из браузера", 1);
    buttons[2] = make_button("Настройка", "Sunshine / Apollo\nПоиск сервера и pairing", 2);
    for (int i = 0; i < LAUNCH_COUNT; i++) {
        gtk_box_pack_start(GTK_BOX(choices), buttons[i], TRUE, TRUE, 0);
    }
    gtk_widget_set_halign(choices, GTK_ALIGN_CENTER);
    gtk_widget_set_valign(choices, GTK_ALIGN_CENTER);

    buttons[HDMI_ITEM] = make_audio_button("HDMI / саундбар", HDMI_ITEM);
    buttons[UMC_ITEM] = make_audio_button("UMC202HD / колонки", UMC_ITEM);
    buttons[NETWORK_ITEM] = gtk_button_new_with_label("Wi-Fi / точка доступа");
    gtk_style_context_add_class(gtk_widget_get_style_context(buttons[NETWORK_ITEM]), "audio-button");
    g_signal_connect(buttons[NETWORK_ITEM], "clicked", G_CALLBACK(button_clicked), GINT_TO_POINTER(NETWORK_ITEM));
    gtk_box_pack_start(GTK_BOX(audio_choices), buttons[HDMI_ITEM], TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(audio_choices), buttons[UMC_ITEM], TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(audio_choices), buttons[NETWORK_ITEM], TRUE, TRUE, 0);
    gtk_widget_set_halign(audio_choices, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(audio_box), audio_title, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(audio_box), audio_choices, FALSE, FALSE, 0);

    const char *message = getenv("TVBOX_STATUS");
    if (message != NULL) {
        gtk_label_set_text(GTK_LABEL(status_label), message);
    }
    gtk_container_set_border_width(GTK_CONTAINER(outer), 48);
    gtk_box_pack_start(GTK_BOX(outer), title, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(outer), subtitle, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(outer), choices, TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(outer), audio_box, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(outer), status_label, FALSE, FALSE, 0);
    gtk_container_add(GTK_CONTAINER(window), outer);

    g_signal_connect(window, "key-press-event", G_CALLBACK(key_pressed), NULL);
    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);
    gtk_widget_show_all(window);
    select_item(0);
    request_audio(NULL);
    gtk_main();
    g_object_unref(css);
    return result;
}
