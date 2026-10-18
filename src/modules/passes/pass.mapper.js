const { authenticator } = require('otplib');

class PassDataMapper {
  /**
   * Generates dynamic barcode payload with current TOTP token: ticketId:totp_token
   */
  static generateBarcodePayload(ticketId, secret) {
    if (!secret) {
      return ticketId;
    }
    const token = authenticator.generate(secret);
    return `${ticketId}:${token}`;
  }

  /**
   * Map internal event & ticket model to Apple PassKit JSON structure (type: eventTicket)
   */
  static toAppleEventPass(ticket, event) {
    const barcodePayload = this.generateBarcodePayload(ticket.id, ticket.secret);

    return {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || 'pass.com.platform.event',
      serialNumber: ticket.id,
      teamIdentifier: process.env.APPLE_TEAM_ID || 'TEAM12345',
      organizationName: 'Headless E-Ticketing Platform',
      description: event ? event.name : 'Event Ticket',
      logoText: 'E-Ticket',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(15, 23, 42)',
      labelColor: 'rgb(148, 163, 184)',
      barcode: {
        message: barcodePayload,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1'
      },
      barcodes: [
        {
          message: barcodePayload,
          format: 'PKBarcodeFormatQR',
          messageEncoding: 'iso-8859-1'
        }
      ],
      eventTicket: {
        primaryFields: [
          {
            key: 'event',
            label: 'EVENT',
            value: event ? event.name : 'Event Ticket'
          }
        ],
        secondaryFields: [
          {
            key: 'location',
            label: 'LOCATION',
            value: event ? event.venue : 'TBA'
          },
          {
            key: 'date',
            label: 'DATE',
            value: event ? event.date : ''
          }
        ],
        auxiliaryFields: [
          {
            key: 'section',
            label: 'SECTION',
            value: ticket.section || 'General Admission'
          },
          {
            key: 'seat',
            label: 'SEAT',
            value: ticket.seat || 'GA'
          }
        ],
        backFields: [
          {
            key: 'ticketId',
            label: 'Ticket ID',
            value: ticket.id
          },
          {
            key: 'owner',
            label: 'Owner Contact',
            value: ticket.ownerContact
          },
          {
            key: 'status',
            label: 'Ticket Status',
            value: ticket.status
          }
        ]
      }
    };
  }

  /**
   * Map internal loyalty account model to Apple PassKit JSON structure (type: storeCard)
   */
  static toAppleLoyaltyPass(loyalty) {
    return {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || 'pass.com.platform.loyalty',
      serialNumber: loyalty.id,
      teamIdentifier: process.env.APPLE_TEAM_ID || 'TEAM12345',
      organizationName: 'Platform Loyalty Rewards',
      description: `${loyalty.tier} Loyalty Card`,
      logoText: 'Loyalty Club',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(30, 41, 59)',
      labelColor: 'rgb(203, 213, 225)',
      barcode: {
        message: loyalty.accountNumber,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1'
      },
      barcodes: [
        {
          message: loyalty.accountNumber,
          format: 'PKBarcodeFormatQR',
          messageEncoding: 'iso-8859-1'
        }
      ],
      storeCard: {
        primaryFields: [
          {
            key: 'points',
            label: 'POINTS BALANCE',
            value: loyalty.points
          }
        ],
        secondaryFields: [
          {
            key: 'tier',
            label: 'MEMBERSHIP TIER',
            value: loyalty.tier
          }
        ],
        auxiliaryFields: [
          {
            key: 'accountNumber',
            label: 'ACCOUNT NUMBER',
            value: loyalty.accountNumber
          }
        ]
      }
    };
  }

  /**
   * Map internal event & ticket model to Google Wallet EventTicket Object
   */
  static toGoogleEventPass(ticket, event) {
    const barcodePayload = this.generateBarcodePayload(ticket.id, ticket.secret);
    const issuerId = process.env.GOOGLE_ISSUER_ID || '33880000000221100';
    const classId = `${issuerId}.event_${ticket.eventId}`;
    const objectId = `${issuerId}.ticket_${ticket.id}`;

    return {
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'service-account@platform.iam.gserviceaccount.com',
      aud: 'google',
      typ: 'savetogooglepay',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        eventTicketClasses: [
          {
            id: classId,
            issuerName: 'Headless E-Ticketing Platform',
            eventName: {
              defaultValue: {
                language: 'en-US',
                value: event ? event.name : 'Event'
              }
            },
            venue: {
              name: {
                defaultValue: {
                  language: 'en-US',
                  value: event ? event.venue : 'TBA'
                }
              }
            }
          }
        ],
        eventTicketObjects: [
          {
            id: objectId,
            classId: classId,
            state: 'ACTIVE',
            barcode: {
              type: 'QR_CODE',
              value: barcodePayload,
              alternateText: ticket.id
            },
            seatInfo: {
              seat: {
                defaultValue: {
                  language: 'en-US',
                  value: ticket.seat || 'GA'
                }
              },
              section: {
                defaultValue: {
                  language: 'en-US',
                  value: ticket.section || 'GA'
                }
              }
            },
            ticketHolderName: ticket.ownerContact
          }
        ]
      }
    };
  }

  /**
   * Map internal loyalty account model to Google Wallet Loyalty Object
   */
  static toGoogleLoyaltyPass(loyalty) {
    const issuerId = process.env.GOOGLE_ISSUER_ID || '33880000000221100';
    const classId = `${issuerId}.loyalty_tier_${loyalty.tier.toLowerCase().replace(/\s+/g, '_')}`;
    const objectId = `${issuerId}.loyalty_${loyalty.id}`;

    return {
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'service-account@platform.iam.gserviceaccount.com',
      aud: 'google',
      typ: 'savetogooglepay',
      iat: Math.floor(Date.now() / 1000),
      payload: {
        loyaltyClasses: [
          {
            id: classId,
            issuerName: 'Platform Loyalty Rewards',
            programName: {
              defaultValue: {
                language: 'en-US',
                value: `${loyalty.tier} Rewards Program`
              }
            },
            reviewStatus: 'UNDER_REVIEW'
          }
        ],
        loyaltyObjects: [
          {
            id: objectId,
            classId: classId,
            state: 'ACTIVE',
            accountName: loyalty.ownerContact,
            accountId: loyalty.accountNumber,
            barcode: {
              type: 'QR_CODE',
              value: loyalty.accountNumber,
              alternateText: loyalty.accountNumber
            },
            loyaltyPoints: {
              balance: {
                string: String(loyalty.points)
              },
              label: 'Points'
            }
          }
        ]
      }
    };
  }
}

module.exports = PassDataMapper;
