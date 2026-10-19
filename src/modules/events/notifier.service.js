class NotifierService {
  /**
   * Interface for notifying ticket holders of reissuance.
   * Can be implemented with SMS / Email integrations.
   */
  notifyReissue(ticket) {
    const contact = ticket.holder_phone || ticket.owner_email || 'No contact info';
    console.log(`[Notifier] Reissue notification queued for ticket ${ticket.id} (${contact})`);
  }
}

module.exports = new NotifierService();
