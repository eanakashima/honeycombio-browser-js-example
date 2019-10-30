func (h *UserEventsHandler) sendToHoneycombAPI(eventType string, metadata map[string]interface{}, user *types.User) {
    ev := h.Libhoney.NewEvent()
    ev.Dataset = "user-events"      // Name of the Honeycomb dataset we'll send these events to
    ev.AddField("type", eventType)  // Name of the type of event, in our case either "page-load" or "page-unload"
    ev.Add(metadata)                // All those event fields we constructed in the browser

    // And then we add some fields we have easy access to, because we know the
    // current user by their session:
    ev.AddField("user_id", user.ID)
    ev.AddField("user_email", user.Email)

    // Send the event to the Honeycomb API (goes to our internal Dogfood
    // Honeycomb cluster when called in Production).
    ev.Send()
}
